"use client";
import { mainnet, sepolia } from "viem/chains";
import React, { useEffect, useState, useCallback } from 'react';
import './styles.css';
import TransferArrow from '../icons/transferArrow';
import {
  DynamicConnectButton,
  useUserWallets,
  useDynamicContext,
  Wallet,
} from "@dynamic-labs/sdk-react-core";
import { Cross, ConnectIcon } from "../icons";
import { createPublicClient, formatEther, http, parseEther, WalletClient } from 'viem'
import { Transport, Chain, Account } from 'viem'
import { getBalance } from 'viem/actions';
import { truncateWalletAddress } from '@/lib/stringUtils';
import { solanaToBytes32 } from '@/lib/solanaUtils'
import Skeleton from 'react-loading-skeleton'
import 'react-loading-skeleton/dist/skeleton.css'
import { generateTxObjectForDetails } from "@/lib/activityUtils";
import { TransactionDetails } from "./TransactionDetails";
import { useTransaction } from "../TransactionPool"

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BRIDGE_CONTRACT || ''
const MIN_DEPOSIT_AMOUNT = 0.002;

const CONTRACT_ABI = [{
      inputs: [{
          internalType: 'bytes32',
          name: '',
          type: 'bytes32'
      }, {
          internalType: 'uint256',
          name: '',
          type: 'uint256'
      }, ],
      name: 'deposit',
      outputs: [],
      stateMutability: 'payable',
      type: 'function',
}];

const client = createPublicClient({
  chain: (process.env.NEXT_PUBLIC_CURRENT_CHAIN === "mainnet") ? mainnet : sepolia,
  transport: (process.env.NEXT_PUBLIC_CURRENT_CHAIN === "mainnet") ? http() : http("https://sepolia.drpc.org"),
  cacheTime: 0
})

export interface DepositContentProps {
  activeTxState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
  modalStuff: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
  amountEther: number | string | undefined;
  setAmountEther: React.Dispatch<React.SetStateAction<number | undefined | string>>;
}

export const DepositContent: React.FC<DepositContentProps> = ({ activeTxState, modalStuff, amountEther, setAmountEther }) => {
  const [walletClient, setWalletClient] = useState<WalletClient<Transport, Chain, Account> | null>(null);
  const [balanceEther, setAmountBalanceEther] = useState<number>(-1);
  const [isEvmDisconnected, setIsEvmDisconnected] = useState(false);
  const [isSolDisconnected, setIsSolDisconnected] = useState(false);
  const [isModalOpen, setIsModalOpen] = modalStuff; 
  const [currentTx, setCurrentTx] = useState<any>(null);

  const userWallets: Wallet[] = useUserWallets() as Wallet[];
  const solWallet = userWallets.find(w => w.chain == "SOL");
  const evmWallet = userWallets.find(w => w.chain == "EVM");

  useEffect(() => {
    let lWalletClient = evmWallet?.connector.getWalletClient<WalletClient<Transport, Chain, Account>>();
    if (lWalletClient) { 
      lWalletClient.cacheTime = 0;
    }

    setWalletClient(lWalletClient ?? null);
  }, [evmWallet?.connector])

  const { handleUnlinkWallet, rpcProviders } = useDynamicContext();
  const { addNewDeposit } = useTransaction();

  const provider = rpcProviders.evmDefaultProvider;
  const setInputRef = useCallback((node: HTMLInputElement) => {
    if (node) {
      const handleWheel = (event: WheelEvent) => {
        event.preventDefault()
      };
      node.addEventListener('wheel', handleWheel);
      return () => {
        node.removeEventListener('wheel', handleWheel);
      };
    }
  }, []);

  useEffect(() => {
    userWallets.forEach(async (wallet) => {
      if (!wallet) return;
      // ignore this for sepolia
      if (( !provider && process.env.NEXT_PUBLIC_CURRENT_CHAIN === "mainnet")|| !(wallet.chain == "EVM")) return;
      const balance = await getBalance(client, {
        //@ts-ignore
        address: wallet.address,
        blockTag: 'safe'
      })

      const balanceAsEther = formatEther(balance);
      const formattedEtherBalance = balanceAsEther.includes('.') ? balanceAsEther.slice(0, balanceAsEther.indexOf('.') + 5) : balanceAsEther
      const balanceEther = parseFloat(formattedEtherBalance);
      setAmountBalanceEther(balanceEther);
    });
  }, [userWallets]);

  const submitDeposit = async () => {
    setIsModalOpen(true);
    const destinationBytes32 = solanaToBytes32(solWallet?.address || '');
    const [account] = await walletClient!.getAddresses()
    const weiValue = parseEther(amountEther?.toString() || '');

    try {
      const { request } = await client.simulateContract({
        //@ts-ignore
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: 'deposit',
        args: [destinationBytes32, weiValue],
        account,
        value: weiValue,
        chain: (process.env.NEXT_PUBLIC_CURRENT_CHAIN === "mainnet") ? mainnet : sepolia
      })
      let txResponse = await walletClient!.writeContract(request);
      // rabby returns the tx hash without 0x
      if (!txResponse.startsWith("0x"))
        txResponse = `0x${txResponse}`

      await client.waitForTransactionReceipt({ hash: txResponse, retryCount: 150, retryDelay: 2_000 }); 
      const txData = await generateTxObjectForDetails(client, txResponse);

      setAmountEther("");
      addNewDeposit(txData);
      setCurrentTx(txData);

    } catch (error) {
      setIsModalOpen(false);
      console.error('Failed to deposit', error);
    }
  };

  function determineInputClass(): string {
    if (!evmWallet || !solWallet) return 'disabled';
    if (parseFloat(amountEther as string) > balanceEther) {
      return 'alarm'
    }
    return ""
  }

  function determineButtonClass(): string {
    if (!evmWallet || !solWallet) {
      return 'submit-button disabled'
    }
    if (!amountEther) {
      return 'submit-button disabled'
    }  
    if (parseFloat(amountEther as string) < MIN_DEPOSIT_AMOUNT) {
      return 'submit-button disabled'
    }

    if (parseFloat(amountEther as string) > balanceEther) {
      return 'submit-button alarm'
    }
    return 'submit-button' 
  }

  function determineButtonText(): string {
    if (!evmWallet && solWallet) {
      return "Connect Ethereum Wallet"
    }
    if (evmWallet && !solWallet) {
      return "Connect Eclipse Wallet"
    }
    if (!evmWallet && !solWallet) {
      return "Connect Wallets"
    }
    if (!amountEther) {
      return 'Deposit'
    }  
    if (parseFloat(amountEther as string) < MIN_DEPOSIT_AMOUNT) {
      return 'Min amount 0.002 ETH'
    }

    if (parseFloat(amountEther as string) > balanceEther) {
      return 'Insufficient Funds'
    }
    
    return 'Deposit'
  }

  return (
    <>
    <div className={isModalOpen ? "status-overlay active" : "status-overlay"}></div>
    { !isModalOpen && <div>
        <div className="network-section">
          <div className="arrow-container">
            <TransferArrow />
          </div>
          <div className="network-box">
            <div className="network-info flex items-center justify-center">
              <div className='network-info-left-section flex items-center justify-center'>
                <img src="eth.png" alt="Ethereum" style={{ objectFit: "cover", height: "44px", width: "44px"}} />
                <div className="input-inner-container">
                  <span className="direction">From</span>
                  <span className="name">{process.env.NEXT_PUBLIC_SOURCE_CHAIN_NAME}</span>
                </div>
              </div>
              {evmWallet && <div className="network-info-right-section">
                <div onClick={() => evmWallet && handleUnlinkWallet(evmWallet.id) && setIsEvmDisconnected(!isEvmDisconnected)} className="disconnect">
                  <Cross crossClassName="deposit-cross" />
                  <div>Disconnect</div>
                </div>
                <div className="wallet-addresss">{truncateWalletAddress(userWallets.find(w => w.chain == "EVM")?.address || '')}</div>
              </div>}
              { (!evmWallet && isEvmDisconnected && !isSolDisconnected)
                  ? <DynamicConnectButton>
                      <div className="flex items-center gap-1 modal-connect">
                        <div>
                          <ConnectIcon connectClassName="modal-connect"/>
                        </div>
                        <div className="modal-connect-wallet">Connect Wallet</div>
                      </div>
                    </DynamicConnectButton>
                : null
              }
            </div>
          </div>

          <div className="network-box">
            <div className="network-info">
              <div className='network-info-left-section'>
                <img src="eclipse.png" alt="Eclipse" style={{ objectFit: "cover", height: "44px", width: "44px"}} />
                <div className="input-inner-container">
                  <span className="direction">To</span>
                  <span className="name">{process.env.NEXT_PUBLIC_TARGET_CHAIN_NAME}</span>
                </div>
              </div>
              {solWallet && <div className="network-info-right-section">
                <div onClick={() => solWallet && handleUnlinkWallet(solWallet.id) && setIsSolDisconnected(!isSolDisconnected)} className="disconnect">
                  <Cross crossClassName="deposit-cross" />
                  <div>Disconnect</div>
                </div>
                <div className="wallet-addresss">{truncateWalletAddress(solWallet?.address || '')}</div>
              </div>}
              { (!solWallet && isSolDisconnected && !isEvmDisconnected)
                  ? <DynamicConnectButton>
                      <div className="flex items-center gap-1 modal-connect">
                        <div>
                          <ConnectIcon connectClassName="modal-connect"/>
                        </div>
                        <div className="modal-connect-wallet">Connect Wallet</div>
                      </div>
                    </DynamicConnectButton>
                : null
              }
            </div>
          </div>
        </div>
        <div className={ `amount-input flex flex-col ${determineInputClass()}` }>
          <div className="amount-input-top flex justify-between w-full items-center">
          <div className="input-wrapper"> 
          { (!evmWallet || evmWallet && (balanceEther >= 0))
            ? <input
                disabled={!evmWallet || !solWallet}
                step="0.01"
                min="0"
                placeholder="0 ETH"
                style={{fontWeight: "500"}}
                value={amountEther}
	              ref={setInputRef}
                onChange={(e) => { 
                  const value = e.target.value;
                  if (/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/.test(value) || value === '') {
                    const [_, dp] = value.split(".");
                    if (!dp || dp.length <= 9) {
                      setAmountEther(value);
                    }
                  } 
                }} 
            />
            : <Skeleton height={40} width={160} />
          }
          </div> 
            <div className="token-display" style={{width: "45%"}}>
              <div className="token-icon">
                <img src="eth.png" alt="ETH Icon" />
              </div>
              <div className="token-name">ETH</div>
            </div>
          </div>
          <div className={`${evmWallet ? '' : 'hidden'} amount-input-bottom flex flex-row justify-between w-full items-center`}>
            {evmWallet && 
              <div className="balance-info w-full">
                <span>Bal</span> 
                {(balanceEther >= 0)
                ?  <><span style={{ color: '#fff' }}>{balanceEther + " "} </span> <>ETH</></> 
                :  <span style={{width: "20%"}}><Skeleton inline={true}/></span>
                }
              </div>
            }
            <div className={evmWallet ? "percentage-buttons" : "invisible"}>
              <button onClick={() => setAmountEther(balanceEther * 0.25)} className="percentage-button">25%</button>
              <button onClick={() => setAmountEther(balanceEther * 0.50)} className="percentage-button">50%</button>

              <button onClick={() => setAmountEther(balanceEther)} className="percentage-button">Max</button>
            </div>
          </div>
        </div>
        { (!evmWallet || !solWallet) 
        ?
            <DynamicConnectButton buttonClassName="wallet-connect-button w-full" buttonContainerClassName="submit-button connect-btn">
              <span style={{ width: '100%' }}> {determineButtonText()}</span>
            </DynamicConnectButton>
        : 
            <button className={`w-full deposit-button p-4 ${determineButtonClass()}`} onClick={submitDeposit}>
              {determineButtonText()}
            </button>
        }
        </div>
    }
        
    { isModalOpen && <TransactionDetails fromDeposit={true} tx={currentTx} closeModal={() => {
        setTimeout(() => { setIsModalOpen(false), setCurrentTx(null) }, 100);
    }} /> }
    </>
  );
};

