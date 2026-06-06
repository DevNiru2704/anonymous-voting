"use client";

import React, { useState, useEffect } from "react";
import { isConnected, getAddress, requestAccess, signTransaction, getNetworkDetails } from "@stellar/freighter-api";
import { rpc, TransactionBuilder, Networks, xdr, Address, Operation, scValToNative, nativeToScVal, Account } from "@stellar/stellar-sdk";
import { Loader2, CheckCircle2, ShieldCheck, UserCheck, Play, Lock, Eye, AlertCircle, BarChart3, Unlock, Activity, Fingerprint, ChevronRight } from "lucide-react";
import { generateSecret, hashVote, buf2hex, hex2buf } from "../lib/crypto";

export default function Home() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txLoading, setTxLoading] = useState(false);
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");
  
  // Local state for the user's secret and vote
  const [savedSecret, setSavedSecret] = useState<string | null>(null);
  const [savedVote, setSavedVote] = useState<number | null>(null);
  const [results, setResults] = useState<{ [key: number]: number } | null>(null);

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";
  const networkPassphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || Networks.TESTNET;
  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "";
  
  const server = new rpc.Server(rpcUrl, { allowHttp: true });

  useEffect(() => {
    // Load saved vote and secret from local storage
    if (typeof window !== "undefined") {
      const s = localStorage.getItem("voting_secret");
      const v = localStorage.getItem("voting_choice");
      if (s) setSavedSecret(s);
      if (v) setSavedVote(Number(v));
    }
  }, []);

  const connectWallet = async () => {
    try {
      setLoading(true);
      setError("");
      const connectedRes = await isConnected();
      if (!connectedRes.isConnected) {
        setError("Freighter is not installed!");
        return;
      }
      const access = await requestAccess();
      if (access.error || !access.address) {
        setError(access.error || "Failed to get address");
        return;
      }
      setWallet(access.address);
      
      const netInfo = await getNetworkDetails();
      if (netInfo.network !== "TESTNET") {
        setError("Please switch Freighter to Testnet.");
      }
    } catch (e) {
      console.error(e);
      setError("Failed to connect Freighter.");
    } finally {
      setLoading(false);
    }
  };

  const simulateCall = async (method: string, args: xdr.ScVal[]) => {
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
    const source = "GAYSGESOOLDZBS3IEZMHOVMFVQJKBV2G6LLU5XHI7L6X2JM6XPQODC43"; // Dummy account
    const account = await server.getAccount(source).catch(() => new Account(source, "1"));
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase }).addOperation(op).setTimeout(30).build();
    const sim = await server.simulateTransaction(tx);
    return sim;
  };

  const fetchState = async () => {
    try {
      if (!contractId) return;
      const sim = await simulateCall("get_state", []);
      if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
        const res = scValToNative(sim.result.retval);
        setState(res);
      } else {
        setState(null);
      }
    } catch (e) {
      console.error("Failed to fetch state", e);
      setState(null);
    }
  };

  const fetchResults = async () => {
    if (!state || !state.options) return;
    try {
      const tallies: { [key: number]: number } = {};
      for (const opt of state.options) {
        const sim = await simulateCall("get_votes", [nativeToScVal(opt, { type: "u32" })]);
        if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
          const tally = scValToNative(sim.result.retval);
          tallies[opt] = Number(tally);
        }
      }
      setResults(tallies);
    } catch (e) {
      console.error("Failed to fetch results", e);
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

  const handleInit = async () => {
    if (!wallet) return;
    setTxLoading(true);
    setError("");
    setSuccessMsg("");
    try {
      const args = [
        nativeToScVal(wallet, { type: "address" }),
        nativeToScVal([1, 2], { type: "vec" }), // Options 1 (Yes) and 2 (No)
        nativeToScVal(60 * 60, { type: "u64" }), // 1 hour commit
        nativeToScVal(60 * 60, { type: "u64" }) // 1 hour reveal
      ];

      await invokeContract("init", args);
      setSuccessMsg("Poll successfully initialized!");
      await fetchState();
    } catch (e: any) {
      setError(e.message || "Init failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleCommit = async (voteOption: number) => {
    if (!wallet) {
      setError("Please connect your wallet first.");
      return;
    }
    setTxLoading(true);
    setError("");
    setSuccessMsg("");
    try {
      const secretBytes = generateSecret();
      const hashBytes = await hashVote(voteOption, secretBytes);
      
      const args = [
        nativeToScVal(wallet, { type: "address" }),
        xdr.ScVal.scvBytes(Buffer.from(hashBytes))
      ];

      await invokeContract("commit", args);
      
      const secretHex = buf2hex(secretBytes);
      localStorage.setItem("voting_secret", secretHex);
      localStorage.setItem("voting_choice", voteOption.toString());
      setSavedSecret(secretHex);
      setSavedVote(voteOption);
      setSuccessMsg("Vote committed! Your secret is safely stored in this browser.");
    } catch (e: any) {
      setError(e.message || "Commit failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleReveal = async () => {
    if (!wallet) {
      setError("Please connect your wallet first.");
      return;
    }
    if (!savedSecret || savedVote === null) {
      setError("No saved secret or vote found in this browser. Cannot reveal.");
      return;
    }
    
    setTxLoading(true);
    setError("");
    setSuccessMsg("");
    try {
      const secretBytes = hex2buf(savedSecret);
      const args = [
        nativeToScVal(wallet, { type: "address" }),
        nativeToScVal(savedVote, { type: "u32" }),
        xdr.ScVal.scvBytes(Buffer.from(secretBytes))
      ];

      await invokeContract("reveal", args);
      setSuccessMsg("Vote revealed successfully!");
    } catch (e: any) {
      setError(e.message || "Reveal failed");
    } finally {
      setTxLoading(false);
    }
  };

  // Determine current phase
  let currentPhase = "NOT_INITIALIZED";
  let timeLeft = "";
  if (state) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const commitEnd = Number(state.commit_end_time);
    const revealEnd = Number(state.reveal_end_time);

    if (nowSeconds <= commitEnd) {
      currentPhase = "COMMIT";
      timeLeft = Math.max(0, Math.floor((commitEnd - nowSeconds) / 60)) + "m left";
    } else if (nowSeconds <= revealEnd) {
      currentPhase = "REVEAL";
      timeLeft = Math.max(0, Math.floor((revealEnd - nowSeconds) / 60)) + "m left";
    } else {
      currentPhase = "RESULTS";
      if (!results) fetchResults();
    }
  }

  // Calculate total votes for the progress bar
  const totalVotes = results ? Object.values(results).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="min-h-screen relative font-sans overflow-hidden">
      
      {/* Animated Background Orbs */}
      <div className="absolute top-0 -left-4 w-72 h-72 bg-cyan-500 rounded-full mix-blend-multiply filter blur-[128px] opacity-30 animate-blob"></div>
      <div className="absolute top-0 -right-4 w-72 h-72 bg-fuchsia-500 rounded-full mix-blend-multiply filter blur-[128px] opacity-30 animate-blob animation-delay-2000"></div>
      <div className="absolute -bottom-8 left-20 w-72 h-72 bg-emerald-500 rounded-full mix-blend-multiply filter blur-[128px] opacity-30 animate-blob animation-delay-4000"></div>

      {/* Glassmorphic Navbar */}
      <nav className="fixed top-0 w-full z-50 glass-panel border-b-0">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-cyan-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Fingerprint className="text-white" size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-white">AnonVote</h1>
          </div>
          
          {!wallet ? (
            <button
              onClick={connectWallet}
              disabled={loading}
              className="bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-full text-sm font-semibold transition-all border border-white/10 flex items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : "Connect Wallet"}
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-emerald-500/10 px-4 py-2 rounded-full text-sm border border-emerald-500/20 shadow-[0_0_15px_rgba(52,211,153,0.1)]">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
              <span className="font-mono text-emerald-100">{wallet.slice(0, 4)}...{wallet.slice(-4)}</span>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content Dashboard */}
      <main className="relative z-10 pt-32 pb-20 px-6 max-w-4xl mx-auto flex flex-col gap-8">
        
        {/* Notifications */}
        {error && (
          <div className="glass-card bg-red-900/30 border-red-500/30 p-4 flex items-center gap-3 text-red-200 animate-in slide-in-from-top-4">
            <AlertCircle size={20} className="text-red-400" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {successMsg && (
          <div className="glass-card bg-emerald-900/30 border-emerald-500/30 p-4 flex items-center gap-3 text-emerald-200 animate-in slide-in-from-top-4">
            <CheckCircle2 size={20} className="text-emerald-400" />
            <p className="text-sm font-medium">{successMsg}</p>
          </div>
        )}

        {/* Dynamic Voting Dashboard */}
        <div className="glass-panel rounded-3xl p-8 sm:p-10">
          
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
            <div>
              <h2 className="text-3xl font-bold mb-2">Proposal <span className="neon-text-cyan">#804</span></h2>
              <p className="text-slate-400">Should we increase the community treasury grant limits?</p>
            </div>
            
            {state && (
               <div className="flex items-center gap-4 bg-slate-800/50 p-3 rounded-2xl border border-slate-700/50">
                 <div className="px-4 py-2 rounded-xl bg-slate-900/80">
                   <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-1">Phase</p>
                   <p className={`font-bold text-sm ${currentPhase === "RESULTS" ? "neon-text-purple" : "neon-text-emerald"}`}>
                     {currentPhase}
                   </p>
                 </div>
                 <div className="px-4 py-2 rounded-xl bg-slate-900/80">
                   <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-1">Time Left</p>
                   <p className="font-bold text-sm text-slate-200 flex items-center gap-1.5">
                     <Activity size={14} className="text-cyan-400" />
                     {timeLeft || "Ended"}
                   </p>
                 </div>
               </div>
            )}
          </div>

          <div className="space-y-8">
            {currentPhase === "NOT_INITIALIZED" && (
              <div className="glass-card p-12 flex flex-col items-center text-center">
                <ShieldCheck size={48} className="text-slate-600 mb-6" />
                <h3 className="text-2xl font-bold mb-3">Poll Awaiting Initialization</h3>
                <p className="text-slate-400 mb-8 max-w-md">The smart contract needs to be initialized by the administrator before voting can commence.</p>
                {wallet && (
                  <button
                    onClick={handleInit}
                    disabled={txLoading}
                    className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-8 py-3.5 rounded-xl font-bold transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(52,211,153,0.3)] flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {txLoading ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                    Initialize Smart Contract
                  </button>
                )}
              </div>
            )}

            {currentPhase === "COMMIT" && (
              <div className="animate-in fade-in duration-500">
                <div className="flex items-center gap-2 mb-6 text-cyan-400">
                  <Lock size={18} />
                  <h3 className="font-semibold tracking-wide">Commitment Phase Active</h3>
                </div>
                
                {savedSecret ? (
                  <div className="glass-card border-emerald-500/30 p-8 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-cyan-400"></div>
                    <CheckCircle2 size={48} className="text-emerald-400 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold mb-2">Vote Committed</h3>
                    <p className="text-slate-400 max-w-md mx-auto mb-6">Your cryptographic proof has been submitted to the ledger. Return during the Reveal Phase to unmask your vote.</p>
                    <div className="bg-slate-900/80 p-3 rounded-lg inline-block border border-slate-700">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-bold">Your Secret Hash</p>
                      <p className="font-mono text-xs text-slate-300">{savedSecret}</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-6">
                    <button 
                      onClick={() => handleCommit(1)}
                      disabled={txLoading}
                      className="group glass-card p-8 hover:bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/50 transition-all text-left relative overflow-hidden disabled:opacity-50"
                    >
                      <div className="absolute right-0 top-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-emerald-500/20 transition-all"></div>
                      <span className="text-emerald-400 font-mono text-sm font-bold tracking-widest mb-2 block">OPTION 1</span>
                      <h3 className="text-3xl font-extrabold text-white mb-2 group-hover:neon-text-emerald transition-all">Vote YES</h3>
                      <p className="text-slate-400 text-sm">Approve the treasury limit increase.</p>
                      <ChevronRight className="absolute bottom-8 right-8 text-emerald-500/0 group-hover:text-emerald-500/100 transform translate-x-4 group-hover:translate-x-0 transition-all" />
                    </button>
                    
                    <button 
                      onClick={() => handleCommit(2)}
                      disabled={txLoading}
                      className="group glass-card p-8 hover:bg-rose-500/10 border-rose-500/20 hover:border-rose-500/50 transition-all text-left relative overflow-hidden disabled:opacity-50"
                    >
                      <div className="absolute right-0 top-0 w-32 h-32 bg-rose-500/10 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-rose-500/20 transition-all"></div>
                      <span className="text-rose-400 font-mono text-sm font-bold tracking-widest mb-2 block">OPTION 2</span>
                      <h3 className="text-3xl font-extrabold text-white mb-2 group-hover:text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0)] group-hover:drop-shadow-[0_0_8px_rgba(244,63,94,0.5)] transition-all">Vote NO</h3>
                      <p className="text-slate-400 text-sm">Reject the proposal and maintain limits.</p>
                      <ChevronRight className="absolute bottom-8 right-8 text-rose-500/0 group-hover:text-rose-500/100 transform translate-x-4 group-hover:translate-x-0 transition-all" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {currentPhase === "REVEAL" && (
              <div className="animate-in fade-in duration-500">
                 <div className="flex items-center gap-2 mb-6 text-fuchsia-400">
                  <Unlock size={18} />
                  <h3 className="font-semibold tracking-wide">Reveal Phase Active</h3>
                </div>

                <div className="glass-card p-8 relative overflow-hidden">
                   <div className="absolute right-0 bottom-0 w-64 h-64 bg-fuchsia-500/10 rounded-full blur-3xl -mr-20 -mb-20"></div>
                   
                   <h3 className="text-2xl font-bold mb-4">Unmask Your Vote</h3>
                   <p className="text-slate-400 mb-8 max-w-lg">
                     The commitment phase has concluded. Submit your transaction now to decrypt your vote using the secret stored in your browser.
                   </p>
                   
                   {savedSecret ? (
                     <button 
                       onClick={handleReveal}
                       disabled={txLoading}
                       className="bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white px-8 py-4 rounded-xl font-bold transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(192,38,211,0.4)] flex items-center gap-3 disabled:opacity-50 disabled:pointer-events-none"
                     >
                       {txLoading ? <Loader2 className="animate-spin" size={20} /> : <Eye size={20} />}
                       Reveal Vote on Ledger
                     </button>
                   ) : (
                     <div className="bg-rose-500/10 border border-rose-500/20 p-5 rounded-xl inline-block">
                       <p className="text-rose-400 font-medium">No Secret Found ⚠️</p>
                       <p className="text-sm text-rose-400/70 mt-1 max-w-xs">If you cleared your browser data, your vote is lost cryptographically.</p>
                     </div>
                   )}
                </div>
              </div>
            )}

            {currentPhase === "RESULTS" && (
              <div className="animate-in zoom-in-95 duration-500">
                <div className="flex items-center gap-2 mb-8 text-cyan-400">
                  <BarChart3 size={20} />
                  <h3 className="font-semibold tracking-wide text-lg">Final Results</h3>
                </div>

                {results ? (
                  <div className="space-y-6">
                    {/* YES Option */}
                    <div>
                      <div className="flex justify-between items-end mb-2">
                         <span className="font-extrabold text-xl">YES</span>
                         <span className="text-emerald-400 font-mono font-bold">{results[1] || 0} Votes</span>
                      </div>
                      <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(52,211,153,0.5)]" 
                          style={{ width: totalVotes > 0 ? `${((results[1] || 0) / totalVotes) * 100}%` : '0%' }}
                        ></div>
                      </div>
                    </div>

                    {/* NO Option */}
                    <div>
                      <div className="flex justify-between items-end mb-2 mt-4">
                         <span className="font-extrabold text-xl">NO</span>
                         <span className="text-rose-400 font-mono font-bold">{results[2] || 0} Votes</span>
                      </div>
                      <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-rose-500 to-orange-400 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(244,63,94,0.5)]" 
                          style={{ width: totalVotes > 0 ? `${((results[2] || 0) / totalVotes) * 100}%` : '0%' }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-center p-12">
                    <Loader2 className="animate-spin text-cyan-500" size={40} />
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
