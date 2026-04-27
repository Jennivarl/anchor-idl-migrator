/**
 * Synthetic fixture: Anchor 0.29 account subscriber.
 * Contains T1 (@project-serum/anchor) and T2 (3-arg generic Program ctor).
 */
import {
    Program,
    AnchorProvider,
    Idl,
} from '@project-serum/anchor';
import { PublicKey, Connection } from '@solana/web3.js';

import openbookV2Idl from '../idl/openbookV2.json';

const OPENBOOK_PROGRAM_ID = 'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb';

export class OpenBookSubscriber {
    program: Program;

    constructor(connection: Connection, provider: AnchorProvider) {
        this.program = new Program(
            openbookV2Idl as Idl,
            new PublicKey(OPENBOOK_PROGRAM_ID),
            provider
        );
    }

    async getMarket(address: PublicKey) {
        return this.program.account.market.fetch(address);
    }
}

export function getMarinadeProgram<T extends Idl>(
    IDL: T,
    marinadeFinanceProgramId: PublicKey,
    provider: AnchorProvider
): Program<T> {
    return new Program<T>(IDL, marinadeFinanceProgramId, provider);
}
