# GSO SDK Change Log

Update this for each SDK release and package publication.

### v0.0.14, 2023-7-20

- chore: use old parser for gso state (#29)

This changes the way the SDK parses buffers from on-chain source
to use older, now deprecated Buffer APIs. Change is intended to
target React Native and Saga, which has proven difficult to
polyfill with newer Buffer types.
