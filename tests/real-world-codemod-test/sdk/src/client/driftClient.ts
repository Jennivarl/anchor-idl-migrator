/**
 * Synthetic fixture: Anchor 0.29 DriftClient-style TS file.
 * Contains T1 (@project-serum/anchor), T2 (3-arg Program ctor),
 * and T3 (.associated/) patterns for migration testing.
 *
 * This is a realistic excerpt modelled after real Anchor 0.29 SDKs.
 */
import {
    AnchorProvider,
    Idl,
    Program,
    BN,
    web3,
} from '@project-serum/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

import driftIDL from '../idl/drift.json';
import { DriftClientConfig } from './driftClientConfig';

const DRIFT_PROGRAM_ID = 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH';

export class DriftClient {
    program: Program;
    provider: AnchorProvider;

    constructor(config: DriftClientConfig) {
        const wallet = config.wallet;
        this.provider = new AnchorProvider(
            config.connection,
            wallet,
            AnchorProvider.defaultOptions()
        );
        this.program = new Program(
            driftIDL as Idl,
            new PublicKey(DRIFT_PROGRAM_ID),
            this.provider
        );
    }

    async updateProvider(newWallet: web3.Keypair): Promise<void> {
        const newProvider = new AnchorProvider(
            this.provider.connection,
            // @ts-ignore
            newWallet,
            this.provider.opts
        );
        const newProgram = new Program(
            driftIDL as Idl,
            this.program.programId,
            newProvider
        );
        this.provider = newProvider;
        this.program = newProgram;
    }

    /**
     * getAssociatedVault — uses deprecated .associated() pattern
     */
    async getAssociatedVault(owner: PublicKey): Promise<PublicKey> {
        return await this.program.account.vault.associated(owner);
    }

    async getAssociatedVaultAddress(owner: PublicKey): Promise<PublicKey> {
        return await this.program.account.vault.associatedAddress(owner);
    }

    async loadMarket(marketIndex: number): Promise<void> {
        const markets = await this.program.account.markets.fetch(
            await this.program.account.markets.associated()
        );
        console.log(`Loaded market index ${marketIndex}`, markets);
    }
}
