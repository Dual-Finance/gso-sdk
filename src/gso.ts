import {
  Commitment,
  ConfirmOptions,
  Connection,
  ConnectionConfig,
  Keypair,
  PublicKey,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
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

export const GSO_PK: PublicKey = new PublicKey('DuALd6fooWzVDkaTsQzDAxPGYCnLrnWamdNNTNxicdX8');

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
    lockupRatioTokensPerMillion: number,
    optionExpiration: number,
    numTokens: number,
    projectName: string,
    strike: number,
    authority: PublicKey,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseAccount: PublicKey,
    quoteAccount: PublicKey,
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

    const soState = await so.state(`GSO${projectName}`, baseMint);
    const soBaseVault = await so.baseVault(`GSO${projectName}`, baseMint);
    const soOptionMint = await so.soMint(strike, `GSO${projectName}`, baseMint);
    const xBaseMint = await this.xBaseMint(gsoState);
    const baseVault = await this.baseVault(gsoState);

    // TODO: Init fee account if needed.

    return this.program.instruction.config(
      new BN(1), /* period_num */
      new BN(lockupRatioTokensPerMillion),
      new BN(optionExpiration),
      new BN(optionExpiration), /* subscription_period_end */
      new BN(1), /* lot_size */
      new BN(numTokens),
      projectName,
      new BN(strike),
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
          soBaseMint: baseMint,
          soQuoteMint: quoteMint,
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
}
