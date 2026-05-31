import { isConnected, requestAccess, signTransaction, setAllowed } from '@stellar/freighter-api';
import { Horizon, rpc, Networks, TransactionBuilder, FeeBumpTransaction } from '@stellar/stellar-sdk';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

export const getNetworkConfig = () => ({
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
  horizonUrl: HORIZON_URL,
});

export const connectFreighter = async (): Promise<string | null> => {
  if (await isConnected()) {
    await setAllowed();
    const result = await requestAccess();
    if (typeof result === 'string') return result;
    if ((result as any)?.address) return (result as any).address;
    return null;
  }
  return null;
};

export const getFreighterPublicKey = async (): Promise<string | null> => {
    return await connectFreighter();
};

export const signAndSubmitTransaction = async (xdr: string): Promise<any> => {
  try {
    const { signedTxXdr, error } = await signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE });
    if (error || !signedTxXdr) {
        throw new Error(error ? (typeof error === "string" ? error : (error as any).message || JSON.stringify(error)) : "Transaction signing failed");
    }
    const server = new rpc.Server(RPC_URL);
    
    const transaction = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
    if (transaction instanceof FeeBumpTransaction) {
        throw new Error("Fee bump transactions not currently supported in this helper");
    }

    const txToSend = await server.prepareTransaction(transaction as any);
    const sendResult = await server.sendTransaction(txToSend as any);

    if (sendResult.status !== 'PENDING') {
      throw new Error(`Transaction failed: ${sendResult.status}`);
    }
    
    // Wait for the transaction to complete
    let txResponse = await server.getTransaction(sendResult.hash);
    let retries = 0;
    while (txResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND && retries < 10) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      txResponse = await server.getTransaction(sendResult.hash);
      retries++;
    }

    if (txResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return txResponse;
    } else {
        throw new Error(`Transaction status: ${txResponse.status}`);
    }

  } catch (err: any) {
    console.error('Submit Error:', err);
    throw new Error(err.message || 'Error submitting transaction');
  }
};

export const fundWithFriendbot = async (publicKey: string) => {
  try {
    const response = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
    if (!response.ok) {
      throw new Error('Failed to fund account with Friendbot');
    }
    return await response.json();
  } catch (error) {
    console.error('Error during Friendbot funding', error);
    throw error;
  }
};
