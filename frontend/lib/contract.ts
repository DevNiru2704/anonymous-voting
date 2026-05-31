import { rpc, xdr, scValToNative, nativeToScVal, Address, TransactionBuilder, Account, Operation } from '@stellar/stellar-sdk';
import { getNetworkConfig, signAndSubmitTransaction } from './stellar';

const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || '';

export const initVote = async (admin: string, options: string[], commitDuration: number, revealDuration: number) => {
    if (!CONTRACT_ID) throw new Error("Contract ID not set");
    
    // Convert inputs to scVals
    const adminVal = new Address(admin).toScVal();
    const optionsVal = xdr.ScVal.scvVec(
        options.map(opt => xdr.ScVal.scvSymbol(opt.substring(0, 32)))  // Symbol max length is 32
    );
    const commitDurationVal = nativeToScVal(commitDuration, { type: 'u64' });
    const revealDurationVal = nativeToScVal(revealDuration, { type: 'u64' });

    const invokeContractOp = new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACT_ID).toScAddress(),
        functionName: 'init',
        args: [adminVal, optionsVal, commitDurationVal, revealDurationVal]
    });

    return await simulateAndSubmit(invokeContractOp, admin);
};

export const commitVote = async (voter: string, commitmentHashHex: string) => {
     if (!CONTRACT_ID) throw new Error("Contract ID not set");
     
     const voterVal = new Address(voter).toScVal();
     const hashBuffer = Buffer.from(commitmentHashHex, 'hex');
     if(hashBuffer.length !== 32) throw new Error("Commitment must be 32 bytes");
     const commitmentVal = xdr.ScVal.scvBytes(hashBuffer);

     const invokeContractOp = new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACT_ID).toScAddress(),
        functionName: 'commit',
        args: [voterVal, commitmentVal]
    });

    return await simulateAndSubmit(invokeContractOp, voter);
}

export const revealVote = async (voter: string, vote: string, secretHex: string) => {
    if (!CONTRACT_ID) throw new Error("Contract ID not set");

    const voterVal = new Address(voter).toScVal();
    const voteVal = xdr.ScVal.scvSymbol(vote.substring(0, 32));
    const secretBuffer = Buffer.from(secretHex, 'hex');
     if(secretBuffer.length !== 32) throw new Error("Secret must be 32 bytes");
    const secretVal = xdr.ScVal.scvBytes(secretBuffer);

    const invokeContractOp = new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACT_ID).toScAddress(),
        functionName: 'reveal',
        args: [voterVal, voteVal, secretVal]
    });

    return await simulateAndSubmit(invokeContractOp, voter);
}

export const getVotes = async (vote: string) => {
     if (!CONTRACT_ID) throw new Error("Contract ID not set");
     
     const voteVal = xdr.ScVal.scvSymbol(vote.substring(0, 32));

     const invokeContractOp = new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACT_ID).toScAddress(),
        functionName: 'get_votes',
        args: [voteVal]
    });

    const result = await simulate(invokeContractOp);
    if (!result || rpc.Api.isSimulationError(result) || !result.result || !result.result.retval) return 0;
    
    const scVal = result.result.retval;
    // Assuming U32 return
    return scValToNative(scVal);
}

export const getState = async () => {
    if (!CONTRACT_ID) return null;

    const invokeContractOp = new xdr.InvokeContractArgs({
        contractAddress: new Address(CONTRACT_ID).toScAddress(),
        functionName: 'get_state',
        args: []
    });

    try {
        const result = await simulate(invokeContractOp);
        if (!result || rpc.Api.isSimulationError(result) || !result.result || !result.result.retval) return null;
        
        const scVal = result.result.retval;
        return scValToNative(scVal);
    } catch(e) {
        console.error("Failed getting state", e);
        return null; // Might not be initialized
    }
}


// --- Helpers ---

const simulate = async (invokeContractOp: xdr.InvokeContractArgs) => {
     const { rpcUrl, networkPassphrase } = getNetworkConfig();
     const server = new rpc.Server(rpcUrl);
     
     // const source = new Address("GBZXN7P3UPCP2ZRHRFDE2QYUK2OIZFOUB73D4L77A3F6U76X2A2Y3S42"); // valid dummy source for simulate only
     const tx = new TransactionBuilder(
        new Account("GBZXN7P3UPCP2ZRHRFDE2QYUK2OIZFOUB73D4L77A3F6U76X2A2Y3S42", "1"),
        { fee: "100", networkPassphrase }
      ).addOperation(Operation.invokeHostFunction({
         func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeContractOp),
         auth: []
      })).setTimeout(30).build();

    const simulateResult = await server.simulateTransaction(tx as any);
    return simulateResult;
}


const simulateAndSubmit = async (invokeContractOp: xdr.InvokeContractArgs, sourceAccount: string) => {
    const { rpcUrl, networkPassphrase } = getNetworkConfig();
    const server = new rpc.Server(rpcUrl);

    const account = await server.getAccount(sourceAccount);
    
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase })
        .addOperation(Operation.invokeHostFunction({
            func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeContractOp),
            auth: []
        }))
        .setTimeout(30)
        .build();

    const preparedTx = await server.prepareTransaction(tx);
    return await signAndSubmitTransaction(preparedTx.toXDR());
}
