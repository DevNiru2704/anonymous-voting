const { Keypair, rpc, TransactionBuilder, Networks, Address, xdr, Operation } = require('@stellar/stellar-sdk');
const fs = require('fs');
const crypto = require('crypto');

async function main() {
    const rpcUrl = "https://soroban-testnet.stellar.org";
    const networkPassphrase = Networks.TESTNET;
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    
    console.log("Generating keypair...");
    const keypair = Keypair.random();
    const sourceAccount = keypair.publicKey();
    console.log("Public Key:", sourceAccount);
    
    console.log("Funding account...");
    await fetch(`https://friendbot.stellar.org?addr=${sourceAccount}`);
    console.log("Account funded.");
    
    const wasmPath = "../contracts/target/wasm32v1-none/release/anonymous_voting.wasm";
    const wasm = fs.readFileSync(wasmPath);
    
    let account = await server.getAccount(sourceAccount);
    
    console.log("Uploading Wasm...");
    const uploadOp = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasm),
        auth: []
    });
    
    let tx = new TransactionBuilder(account, { fee: "100", networkPassphrase })
        .addOperation(uploadOp)
        .setTimeout(30)
        .build();
    
    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(keypair);
    
    let sendResult = await server.sendTransaction(preparedTx);
    let txStatus = await server.getTransaction(sendResult.hash);
    while (txStatus.status === "PENDING" || txStatus.status === "NOT_FOUND") {
        await new Promise(resolve => setTimeout(resolve, 2000));
        txStatus = await server.getTransaction(sendResult.hash);
    }
    
    if (txStatus.status !== "SUCCESS") {
        console.error("Wasm upload failed");
        console.dir(txStatus, { depth: null });
        return;
    }
    
    const resultMetaXdr = txStatus.resultMetaXdr;
    let wasmId;
    try {
        let meta = resultMetaXdr._value || (typeof resultMetaXdr.value === 'function' ? resultMetaXdr.value() : resultMetaXdr.v3());
        let sMeta = meta._attributes ? meta._attributes.sorobanMeta._value : meta.sorobanMeta();
        wasmId = sMeta._attributes ? sMeta._attributes.returnValue._value : sMeta.returnValue().value();
    } catch(e) {
        console.error("Failed to extract wasm ID", e);
        console.dir(txStatus, { depth: null });
        return;
    }
    console.log("Wasm ID:", wasmId.toString('hex'));
    
    console.log("Deploying Contract...");
    account = await server.getAccount(sourceAccount);
    
    const salt = crypto.randomBytes(32);
    
    const createContractOp = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeCreateContract(
            new xdr.CreateContractArgs({
                contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                    new xdr.ContractIdPreimageFromAddress({
                        address: new Address(sourceAccount).toScAddress(),
                        salt: salt
                    })
                ),
                executable: xdr.ContractExecutable.contractExecutableWasm(wasmId)
            })
        ),
        auth: []
    });
    
    let tx2 = new TransactionBuilder(account, { fee: "100", networkPassphrase })
        .addOperation(createContractOp)
        .setTimeout(30)
        .build();
        
    const preparedTx2 = await server.prepareTransaction(tx2);
    preparedTx2.sign(keypair);
    
    let sendResult2 = await server.sendTransaction(preparedTx2);
    let txStatus2 = await server.getTransaction(sendResult2.hash);
    while (txStatus2.status === "PENDING" || txStatus2.status === "NOT_FOUND") {
        await new Promise(resolve => setTimeout(resolve, 2000));
        txStatus2 = await server.getTransaction(sendResult2.hash);
    }
    
    if (txStatus2.status !== "SUCCESS") {
        console.error("Contract deployment failed");
        console.dir(txStatus2, { depth: null });
        return;
    }
    
    let contractIdScAddress;
    try {
        let meta2 = txStatus2.resultMetaXdr._value || (typeof txStatus2.resultMetaXdr.value === 'function' ? txStatus2.resultMetaXdr.value() : txStatus2.resultMetaXdr.v3());
        let sMeta2 = meta2._attributes ? meta2._attributes.sorobanMeta._value : meta2.sorobanMeta();
        let retVal2 = sMeta2._attributes ? sMeta2._attributes.returnValue : sMeta2.returnValue();
        contractIdScAddress = retVal2._value ? retVal2._value : retVal2.address();
    } catch (e) {}
    const contractId = Address.fromScAddress(contractIdScAddress).toString();
    console.log("Contract deployed!");
    console.log("CONTRACT_ID=" + contractId);
}

main().catch(console.error);
