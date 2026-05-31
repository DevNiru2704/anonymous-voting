"use client";
import React, { useState, useEffect } from "react";
import { isConnected, setAllowed, requestAccess, signTransaction } from "@stellar/freighter-api";
import { rpc, TransactionBuilder, Networks, xdr, Address, Operation, scValToNative, nativeToScVal, Account } from "@stellar/stellar-sdk";
import { Loader2, CheckCircle2, ShieldCheck, UserCheck, Play, Lock, Eye } from "lucide-react";

export default function Home() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string>("");

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";
  const networkPassphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || Networks.TESTNET;
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "";
  
  const server = new rpc.Server(rpcUrl, { allowHttp: true });

  const connectWallet = async () => {
    try {
      setLoading(true);
      if (!(await isConnected())) {
        setError("Freighter is not installed!");
        return;
      }
      await setAllowed();
      const { address, error: accessError } = await requestAccess();
      if (accessError || !address) {
        setError(accessError || "Failed to get address");
        return;
      }
      setWallet(address);
    } catch (e) {
      console.error(e);
      setError("Failed to connect Freighter.");
    } finally {
      setLoading(false);
    }
  };

  const fetchState = async () => {
    try {
      if (!contractId) return;
      const op = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(contractId).toScAddress(),
            functionName: "get_state",
            args: []
          })
        ),
        auth: []
      });
      // Source account can be zero account for simulation
      const source = "GAYSGESOOLDZBS3IEZMHOVMFVQJKBV2G6LLU5XHI7L6X2JM6XPQODC43";
      const account = await server.getAccount(source).catch(() => new Account(source, "1"));
      const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase }).addOperation(op).setTimeout(30).build();
      
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
        const res = scValToNative(sim.result.retval);
        setState(res);
      } else {
        setState(null);
      }
    } catch (e) {
      console.error(e);
      setState(null);
    }
  };

  useEffect(() => {
    if (contractId) {
      fetchState();
      const interval = setInterval(fetchState, 10000);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  const handleInit = async () => {
    if (!wallet) return;
    setTxLoading(true);
    setError("");
    try {
      const args = [
        nativeToScVal(wallet, { type: "address" }),
        nativeToScVal([1, 2], { type: "u32" }), // Options 1 (Yes) and 2 (No)
        nativeToScVal(60 * 60, { type: "u64" }), // 1 hour commit
        nativeToScVal(60 * 60, { type: "u64" }) // 1 hour reveal
      ];

      await invokeContract("init", args);
      await fetchState();
    } catch (e: any) {
      setError(e.message || "Init failed");
    } finally {
      setTxLoading(false);
    }
  };

  const invokeContract = async (method: string, args: xdr.ScVal[]) => {
    const account = await server.getAccount(wallet!);
    const op = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(contractId).toScAddress(),
          functionName: method,
          args: args
        })
      ),
      auth: []
    });
    let tx = new TransactionBuilder(account, { fee: "10000", networkPassphrase }).addOperation(op).setTimeout(30).build();
    const preparedTx = await server.prepareTransaction(tx);
    const { signedTxXdr, error: signError } = await signTransaction(preparedTx.toXDR(), { networkPassphrase });
    if (signError || !signedTxXdr) {
      throw new Error(signError || "Transaction signing failed");
    }
    const signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
    const result = await server.sendTransaction(signedTx);
    if (result.status === "ERROR") {
      throw new Error("Transaction submission failed");
    }
    let txStatus = await server.getTransaction(result.hash);
    while (txStatus.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((r) => setTimeout(r, 2000));
      txStatus = await server.getTransaction(result.hash);
    }
    if (txStatus.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error("Transaction Failed");
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-white flex flex-col items-center pt-20 px-4 font-sans">
      <div className="w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-2xl p-8 shadow-2xl backdrop-blur-lg">
        <div className="flex justify-between items-center mb-8 pb-6 border-b border-[#30363d]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.5)]">
              <ShieldCheck className="text-white" size={24} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Anonymous Voting</h1>
          </div>
          {!wallet ? (
            <button
              onClick={connectWallet}
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-full text-sm font-medium transition-all shadow-lg flex items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : "Connect Freighter"}
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-[#21262d] px-4 py-2 rounded-full text-sm border border-[#30363d]">
              <UserCheck size={16} className="text-emerald-400" />
              <span className="font-mono text-gray-300">{wallet.slice(0, 4)}...{wallet.slice(-4)}</span>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {!state ? (
            <div className="text-center py-10">
              <h2 className="text-xl font-semibold mb-2">Voting Not Initialized</h2>
              <p className="text-gray-400 mb-6 text-sm">The administrator must initialize the voting poll.</p>
              {wallet && (
                <button
                  onClick={handleInit}
                  disabled={txLoading}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-lg font-medium transition-all shadow-lg flex items-center gap-2 mx-auto"
                >
                  {txLoading ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                  Initialize Poll
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#21262d] border border-[#30363d] rounded-xl p-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Status</div>
                  <div className="font-semibold text-emerald-400 flex items-center gap-2">
                    <CheckCircle2 size={16} /> Active
                  </div>
                </div>
                <div className="bg-[#21262d] border border-[#30363d] rounded-xl p-4">
                  <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Options</div>
                  <div className="font-semibold">Yes / No</div>
                </div>
              </div>
              
              <div className="bg-indigo-900/20 border border-indigo-500/30 rounded-xl p-6">
                <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <Lock size={18} className="text-indigo-400" />
                  Commit Phase
                </h3>
                <p className="text-sm text-gray-300 mb-4">
                  Vote privately. Your vote is hashed with a secret. You must reveal it later to be counted.
                </p>
                <div className="flex gap-4">
                  <button className="flex-1 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] py-3 rounded-lg font-medium transition-colors">
                    Vote YES
                  </button>
                  <button className="flex-1 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] py-3 rounded-lg font-medium transition-colors">
                    Vote NO
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
