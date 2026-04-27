/**
 * Synthetic fixture: Anchor 0.29 integration test.
 * Contains T1 (@project-serum/anchor), T2 (3-arg Program), T3 (.associated).
 */
import * as anchor from '@project-serum/anchor';
import { Program, AnchorProvider } from '@project-serum/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import { IDL } from '../target/types/my_program';

anchor.setProvider(anchor.AnchorProvider.env());

describe('my-program', () => {
    const provider = anchor.AnchorProvider.env();
    const programId = new PublicKey('MyPr0gramPubKeyXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    const program = new Program(IDL, programId, provider);

    it('initializes vault', async () => {
        const vault = Keypair.generate();
        await program.methods
            .initialize()
            .accounts({ vault: vault.publicKey })
            .signers([vault])
            .rpc();
    });

    it('fetches associated vault', async () => {
        const owner = Keypair.generate().publicKey;
        const vaultAddr = await program.account.vault.associated(owner);
        console.log('vault address:', vaultAddr.toBase58());
    });
});
