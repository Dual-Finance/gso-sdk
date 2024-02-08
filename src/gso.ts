import {
  Commitment,
  ConfirmOptions,
  Connection,
  ConnectionConfig,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  AnchorProvider,
  BN,
  Program,
  Wallet,
  Idl,
  web3,
  utils,
} from '@project-serum/anchor';
import {
  StakingOptions,
  STAKING_OPTIONS_PK,
} from '@dual-finance/staking-options';
import { getAssociatedTokenAddress } from '@project-serum/associated-token';
import gsoIdl from './gso.json';
import { parseGsoState } from './utils';

const GSO_STATE_SIZE = 1000;
export const GSO_PK: PublicKey = new PublicKey(
  'DuALd6fooWzVDkaTsQzDAxPGYCnLrnWamdNNTNxicdX8',
);
const metaplexId = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

interface SOState {
  soName: string;
  authority: PublicKey;
  optionsAvailable: number;
  optionExpiration: number;
  subscriptionPeriodEnd: number;
  baseDecimals: number;
  quoteDecimals: number;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  quoteAccount: PublicKey;
  lotSize: number;
  stateBump: number;
  vaultBump: number;
  strikes: number[];
}
export type GsoParams = {
  periodNum: number;
  subscriptionPeriodEnd: number;
  lockupRatioTokensPerMillion: number;
  authority: PublicKey;
  baseMint: PublicKey;
  lockupPeriodEnd: number;
  gsoStatePk: PublicKey;
  // SO fields
  strike: number;
  projectName: string;
  stakingOptionsState: PublicKey;
  lotSize: number;
  optionExpiration: number;
  quoteMint: PublicKey;
}

/**
 * API class with functions to interact with the Staking Options Program using Solana Web3 JS API
 */
export class GSO {
  private connection: Connection;

  private program: Program;

  private commitment: Commitment | ConnectionConfig | undefined;

  /**
   * Create a GSO object
   *
   * @param rpcUrl The solana cluster endpoint used for the connecton
   */
  constructor(rpcUrl: string, commitment: Commitment | string = 'finalized') {
    this.commitment = commitment as Commitment;
    this.connection = new Connection(
      rpcUrl,
      (this.commitment as Commitment) || 'finalized',
    );

    const opts: ConfirmOptions = {
      preflightCommitment: 'finalized',
      commitment: 'finalized',
    };

    // Public key and payer not actually needed since this does not send transactions.
    const wallet: Wallet = {
      publicKey: GSO_PK,
      signAllTransactions: async (txs) => txs,
      signTransaction: async (tx) => tx,
      payer: new Keypair(),
    };

    const provider = new AnchorProvider(this.connection, wallet, opts);
    this.program = new Program(
      gsoIdl as Idl,
      GSO_PK,
      provider,
    );
  }

  /**
   * Convert a number to bytes in the format that is used in ata seeds.
   */
  private static toBeBytes(x: number) {
    const y = Math.floor(x / 2 ** 32);
    return Uint8Array.from(
      [y, y << 8, y << 16, y << 24, x, x << 8, x << 16, x << 24].map(
        (z) => z >>> 24,
      ),
    );
  }

  /**
   * Get the public key for the gso state.
   */
  public async state(name: string): Promise<PublicKey> {
    const [state, _stateBump] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('GSO-state')),
        GSO.toBeBytes(1), /* period_num */
        Buffer.from(utils.bytes.utf8.encode(name)),
      ],
      this.program.programId,
    );
    return state;
  }

  /**
   * Get the public key for xBase token.
   */
  public async xBaseMint(gsoState: PublicKey): Promise<PublicKey> {
    const [xBaseMint, _xBaseMintBump] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('xGSO')),
        gsoState.toBuffer(),
      ],
      this.program.programId,
    );
    return xBaseMint;
  }

  /**
   * Get the public key for base vault.
   */
  public async baseVault(gsoState: PublicKey): Promise<PublicKey> {
    const [baseVault, _baseVaultBump] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('base-vault')),
        gsoState.toBuffer(),
      ],
      this.program.programId,
    );
    return baseVault;
  }

  /**
   * Create an instruction for config
   */
  public async createConfigInstruction(
    lockupRatioPerMillionLots: number,
    lockupPeriodEnd: number,
    optionExpiration: number,
    subscriptionPeriodEnd: number,
    numTokensAtoms: BN,
    projectName: string,
    strikeAtomsPerLot: number,
    authority: PublicKey,
    lockupMint: PublicKey,
    soBaseMint: PublicKey,
    soQuoteMint: PublicKey,
    baseAccount: PublicKey,
    quoteAccount: PublicKey,
    lotSize: number,
  ): Promise<web3.TransactionInstruction> {
    const gsoState = await this.state(projectName);

    const [soAuthority, soAuthorityBump] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('gso')),
        gsoState.toBuffer(),
      ],
      this.program.programId,
    );
    const so = new StakingOptions(this.connection.rpcEndpoint);

    const soState = await so.state(`GSO${projectName}`, soBaseMint);
    const soBaseVault = await so.baseVault(`GSO${projectName}`, soBaseMint);
    const soOptionMint = await so.soMint(strikeAtomsPerLot, `GSO${projectName}`, soBaseMint);
    const xBaseMint = await this.xBaseMint(gsoState);
    const baseVault = await this.baseVault(gsoState);

    // TODO: Init fee account if needed.

    return this.program.instruction.configV2(
      new BN(1), /* period_num */
      new BN(lockupRatioPerMillionLots),
      new BN(lockupPeriodEnd),
      new BN(optionExpiration),
      new BN(subscriptionPeriodEnd),
      new BN(lotSize),
      numTokensAtoms,
      projectName,
      new BN(strikeAtomsPerLot),
      soAuthorityBump,
      {
        accounts: {
          authority,
          gsoState,
          soAuthority,
          soState,
          soBaseVault,
          soBaseAccount: baseAccount,
          soQuoteAccount: quoteAccount,
          lockupMint,
          soBaseMint,
          soQuoteMint,
          soOptionMint,
          xBaseMint,
          baseVault,
          stakingOptionsProgram: STAKING_OPTIONS_PK,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
          rent: web3.SYSVAR_RENT_PUBKEY,
        },
      },
    );
  }

  /**
   * Create an instruction for name tokens
   * TODO: Once returning multiple insructions, merge this with config
   */
  public async createNameTokensInstruction(
    projectName: string,
    strikeAtomsPerLot: number,
    authority: PublicKey,
    baseMint: PublicKey,
  ): Promise<web3.TransactionInstruction> {
    const gsoState = await this.state(projectName);

    const [soAuthority, _soAuthorityBump] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('gso')),
        gsoState.toBuffer(),
      ],
      this.program.programId,
    );
    const so = new StakingOptions(this.connection.rpcEndpoint);

    const soState = await so.state(`GSO${projectName}`, baseMint);
    const soOptionMint = await so.soMint(strikeAtomsPerLot, `GSO${projectName}`, baseMint);
    const xBaseMint = await this.xBaseMint(gsoState);

    const [optionMetadata, _optionMintMetadataBump] = (
      await web3.PublicKey.findProgramAddress(
        [
          Buffer.from(utils.bytes.utf8.encode('metadata')),
          metaplexId.toBuffer(),
          soOptionMint.toBuffer(),
        ],
        metaplexId,
      ));

    const [xBaseMetadata, _xBaseMintMetadataAccountBump] = (
      await web3.PublicKey.findProgramAddress(
        [
          Buffer.from(utils.bytes.utf8.encode('metadata')),
          metaplexId.toBuffer(),
          xBaseMint.toBuffer(),
        ],
        metaplexId,
      ));

    return this.program.instruction.nameTokens(
      {
        accounts: {
          authority,
          gsoState,
          xBaseMint,
          xBaseMetadata,
          soAuthority,
          soState,
          soOptionMint,
          optionMetadata,
          stakingOptionsProgram: STAKING_OPTIONS_PK,
          tokenMetadataProgram: metaplexId,
          rent: web3.SYSVAR_RENT_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
        },
      },
    );
  }

  /**
   * Create an instruction for stake
   */
  public async createStakeInstruction(
    amount: number,
    projectName: string,
    authority: PublicKey,
    baseMint: PublicKey,
    userBaseAccount: PublicKey,
  ): Promise<web3.TransactionInstruction> {
    const gsoState = await this.state(projectName);

    const [soAuthority, _soAuthorityBump] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('gso')),
        gsoState.toBuffer(),
      ],
      this.program.programId,
    );
    const so = new StakingOptions(this.connection.rpcEndpoint);

    const soState = await so.state(`GSO${projectName}`, baseMint);
    const soStateObj = await so.getState(`GSO${projectName}`, baseMint);
    const strike = soStateObj.strikes[0];

    const soOptionMint = await so.soMint(strike, `GSO${projectName}`, baseMint);
    const xBaseMint = await this.xBaseMint(gsoState);
    const baseVault = await this.baseVault(gsoState);

    // TODO: Possibly init these.
    const soUserOptionAccount = await getAssociatedTokenAddress(authority, soOptionMint);
    const userXBaseAccount = await getAssociatedTokenAddress(authority, xBaseMint);

    return this.program.instruction.stake(
      new BN(amount),
      {
        accounts: {
          authority,
          gsoState,
          soAuthority,
          soOptionMint,
          soState,
          xBaseMint,
          soUserOptionAccount,
          userBaseAccount,
          userXBaseAccount,
          stakingOptionsProgram: STAKING_OPTIONS_PK,
          baseVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      },
    );
  }

  /**
   * Create an instruction for unstake
   */
  public async createUnstakeInstruction(
    amount: number,
    projectName: string,
    authority: PublicKey,
    userBaseAccount: PublicKey,
  ): Promise<web3.TransactionInstruction> {
    const gsoState = await this.state(projectName);

    const xBaseMint = await this.xBaseMint(gsoState);
    const baseVault = await this.baseVault(gsoState);
    const userXBaseAccount = await getAssociatedTokenAddress(authority, xBaseMint);

    return this.program.instruction.unstake(
      new BN(amount),
      {
        accounts: {
          authority,
          gsoState,
          xBaseMint,
          userBaseAccount,
          userXBaseAccount,
          baseVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      },
    );
  }

  /**
   * Create an instruction for withdraw
   */
  public async createWithdrawInstruction(
    projectName: string,
    baseMint: PublicKey,
    authority: PublicKey,
    userBaseAccount: PublicKey,
  ): Promise<web3.TransactionInstruction> {
    const gsoState = await this.state(projectName);
    const so = new StakingOptions(this.connection.rpcEndpoint);
    const soBaseVault = await so.baseVault(`GSO${projectName}`, baseMint);

    const soState = await so.state(`GSO${projectName}`, baseMint);

    const [soAuthority, _soAuthorityBump] = await web3.PublicKey.findProgramAddress(
      [
        Buffer.from(utils.bytes.utf8.encode('gso')),
        gsoState.toBuffer(),
      ],
      this.program.programId,
    );

    return this.program.instruction.withdraw(
      {
        accounts: {
          authority,
          gsoState,
          soState,
          soAuthority,
          soBaseVault,
          userBaseAccount,
          stakingOptionsProgram: STAKING_OPTIONS_PK,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: web3.SystemProgram.programId,
        },
      },
    );
  }

  /**
   * Fetch all stakable GSOs from program accounts.
   * Returns an array of GSO objects representing the account's
   * metadata like name, strike, expiration and subscription timestamps;
   * and its underlying staking option public key.
   * Testing accounts are excluded from the return value.
   */
  public async getGsos(): Promise<GsoParams[]> {
    const { connection } = this;
    const stakingOptions = new StakingOptions(connection.rpcEndpoint);
    const gsoAccounts = await connection.getProgramAccounts(GSO_PK, {
      filters: [{ dataSize: GSO_STATE_SIZE }],
    });
    const allGsoParams = [];
    for (const gsoStateAccount of gsoAccounts) {
      const {
        projectName,
        stakingOptionsState,
        subscriptionPeriodEnd,
        strike,
        lockupRatioTokensPerMillion,
        baseMint,
        authority,
        lockupPeriodEnd,
        periodNum,
      } = parseGsoState(gsoStateAccount.account.data);
      const stakeTimeRemainingMs = subscriptionPeriodEnd * 1000 - Date.now();
      const isTesting = projectName.toLowerCase().includes('trial')
        || projectName.toLowerCase().includes('test');

      if (stakeTimeRemainingMs <= 0 || isTesting || strike === 0) {
        continue;
      }

      const {
        lotSize, quoteMint, optionExpiration,
      } = (await stakingOptions.getState(
        `GSO${projectName}`,
        baseMint,
      )) as unknown as SOState;

      allGsoParams.push({
        periodNum,
        subscriptionPeriodEnd,
        lockupRatioTokensPerMillion,
        strike,
        projectName,
        stakingOptionsState,
        authority,
        baseMint,
        lockupPeriodEnd,
        lotSize,
        optionExpiration,
        quoteMint,
        gsoStatePk: gsoStateAccount.pubkey,
      });
    }
    return allGsoParams;
  }
}
