// Global variables
let provider;
let signer;
let userAddress;
let routerContract;
let tokenContract;
let botInterval;
let botTimeout;
let isConnected = false;
let lastAction = 'sell'; // Start with buy

// Uniswap V2 Router ABI (minimal)
const routerAbi = [
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

// ERC-20 ABI
const erc20Abi = [
  "function transfer(address to, uint amount) public returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)"
];

// Connect to MetaMask and get user address
async function connectWallet() {
    try {
        // Check if MetaMask is installed
        if (!window.ethereum) {
            alert('MetaMask is not installed. Please install MetaMask and try again.');
            return;
        }

        console.log('Connecting to MetaMask...');

        // Create provider
        provider = new ethers.BrowserProvider(window.ethereum);

        // Request account access
        await provider.send("eth_requestAccounts", []);

        // Get signer
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        console.log('Connected to wallet:', userAddress);

        // Check current network and switch if needed
        await ensureMonadTestnet();

        isConnected = true;

        // Update UI
        document.querySelector('.wallet-text').textContent = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
        document.querySelector('.connect-wallet').disabled = true;

        // Set up event listeners for account and chain changes
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', handleChainChanged);

        console.log('Successfully connected to MetaMask on Monad Testnet');

    } catch (error) {
        console.error('Error connecting to MetaMask:', error);
        alert(`Failed to connect to MetaMask: ${error.message}`);
        isConnected = false;
    }
}

// Ensure we're on Monad Testnet
async function ensureMonadTestnet() {
    try {
        const network = await provider.getNetwork();
        const monadTestnetChainId = 10143; // 0x279F in decimal

        console.log('Current network:', network.chainId);

        if (network.chainId !== BigInt(monadTestnetChainId)) {
            console.log('Switching to Monad Testnet...');

            try {
                // Try to switch to Monad Testnet
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x279F' }],
                });
                console.log('Switched to Monad Testnet');
            } catch (switchError) {
                // If network doesn't exist, add it
                if (switchError.code === 4902) {
                    console.log('Adding Monad Testnet...');
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                            chainId: '0x279F',
                            chainName: 'Monad Testnet',
                            nativeCurrency: {
                                name: 'Monad',
                                symbol: 'MON',
                                decimals: 18
                            },
                            rpcUrls: ['https://testnet-rpc.monad.xyz'],
                            blockExplorerUrls: ['https://testnet.monadexplorer.com'],
                        }],
                    });
                    console.log('Added and switched to Monad Testnet');
                } else {
                    throw switchError;
                }
            }

            // Wait a bit for the network switch to complete
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Verify we're on the correct network
            const newNetwork = await provider.getNetwork();
            if (newNetwork.chainId !== BigInt(monadTestnetChainId)) {
                throw new Error('Failed to switch to Monad Testnet');
            }
        } else {
            console.log('Already on Monad Testnet');
        }
    } catch (error) {
        console.error('Error ensuring Monad Testnet:', error);
        throw new Error(`Network error: ${error.message}`);
    }
}

// Check if wallet is still connected
async function checkConnection() {
    try {
        if (!window.ethereum || !provider) {
            return false;
        }

        // Check if accounts are still available
        const accounts = await provider.listAccounts();
        return accounts.length > 0;
    } catch (error) {
        console.error('Error checking connection:', error);
        return false;
    }
}

// Handle account changes
async function handleAccountsChanged(accounts) {
    if (accounts.length === 0) {
        // User disconnected
        disconnectWallet();
    } else {
        // Account changed
        userAddress = accounts[0];
        document.querySelector('.wallet-text').textContent = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
        console.log('Account changed to:', userAddress);
    }
}

// Handle chain changes
function handleChainChanged(chainId) {
    console.log('Network changed to:', chainId);
    // Reload the page to ensure all contracts are reinitialized
    window.location.reload();
}

// Disconnect wallet
function disconnectWallet() {
    isConnected = false;
    provider = null;
    signer = null;
    userAddress = null;
    routerContract = null;
    tokenContract = null;

    document.querySelector('.wallet-text').textContent = 'Connect Wallet';
    document.querySelector('.connect-wallet').disabled = false;
    document.getElementById('startBot').disabled = false;
    document.getElementById('stopBot').disabled = true;
    document.getElementById('botStatus').textContent = 'Bot Status: Stopped';

    stopBot(); // Stop any running bot
    console.log('Wallet disconnected');
}

// Perform swap (buy or sell)
async function performSwap() {
    try {
        if (!isConnected) {
            throw new Error('Wallet not connected');
        }

        // Ensure contracts are initialized
        initContracts();

        const tokenAddress = document.getElementById('tokenAddress').value;
        const amount = document.getElementById('amount').value;
        const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

        let tx;
        let type;

        // Check token balance to decide action
        const tokenBalance = await tokenContract.balanceOf(userAddress);

        if (lastAction === 'sell' || tokenBalance.eq(0)) {
            // Buy: MON to token
            type = 'Buy';
            lastAction = 'buy';
            const amountWei = ethers.parseEther(amount);
            const path = [ethers.ZeroAddress, tokenAddress]; // MON to token
            tx = await routerContract.swapExactETHForTokens(0, path, userAddress, deadline, { value: amountWei });
        } else {
            // Sell: token to MON
            type = 'Sell';
            lastAction = 'sell';
            // Approve router to spend all tokens
            await tokenContract.approve(routerContract.address, tokenBalance);

            const path = [tokenAddress, ethers.ZeroAddress]; // token to MON
            tx = await routerContract.swapExactTokensForETH(tokenBalance, 0, path, userAddress, deadline);
        }

        console.log(`${type} transaction sent:`, tx.hash);

        // Add to transaction history
        addTransactionToTable(type, amount, tx.hash);

        // Monitor transaction status
        const receipt = await tx.wait();
        console.log(`${type} transaction confirmed in block:`, receipt.blockNumber);

        // Update status
        document.getElementById('botStatus').textContent = `Bot Status: ${type} confirmed in block ${receipt.blockNumber}`;
    } catch (error) {
        console.error("Error performing swap:", error);
        document.getElementById('botStatus').textContent = `Bot Status: Error - ${error.message}`;
    }
}

// Start trading bot
async function startBot() {
    if (!isConnected) {
        alert('Please connect your wallet first.');
        return;
    }

    // Double-check connection
    const stillConnected = await checkConnection();
    if (!stillConnected) {
        alert('Wallet connection lost. Please reconnect.');
        disconnectWallet();
        return;
    }

    const intervalSeconds = parseInt(document.getElementById('interval').value);
    const durationMinutes = parseInt(document.getElementById('duration').value);

    initContracts();

    const intervalMs = intervalSeconds * 1000;
    const durationMs = durationMinutes * 60 * 1000;

    document.getElementById('startBot').disabled = true;
    document.getElementById('stopBot').disabled = false;
    document.getElementById('botStatus').textContent = 'Bot Status: Running';

    botInterval = setInterval(async () => {
        // Check connection before each swap
        const connected = await checkConnection();
        if (!connected) {
            console.error('Connection lost during bot operation');
            stopBot();
            alert('Wallet connection lost. Bot stopped.');
            return;
        }
        await performSwap();
    }, intervalMs);

    botTimeout = setTimeout(() => {
        stopBot();
    }, durationMs);
}

// Stop trading bot
function stopBot() {
    clearInterval(botInterval);
    clearTimeout(botTimeout);

    document.getElementById('startBot').disabled = false;
    document.getElementById('stopBot').disabled = true;
    document.getElementById('botStatus').textContent = 'Bot Status: Stopped';
}

// Add transaction to table
function addTransactionToTable(type, amount, hash) {
    const tbody = document.querySelector('.transaction-table tbody');
    const row = document.createElement('tr');

    const assetCell = document.createElement('td');
    assetCell.textContent = 'TOKEN'; // Placeholder

    const typeCell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (type === 'Buy' ? 'buy' : 'sell');
    badge.textContent = type;
    typeCell.appendChild(badge);

    const amountCell = document.createElement('td');
    amountCell.textContent = amount;

    const hashCell = document.createElement('td');
    const link = document.createElement('a');
    link.href = `https://testnet.monadexplorer.com/tx/${hash}`;
    link.target = '_blank';
    link.textContent = `${hash.slice(0, 10)}...${hash.slice(-8)}`;
    hashCell.appendChild(link);

    row.appendChild(assetCell);
    row.appendChild(typeCell);
    row.appendChild(amountCell);
    row.appendChild(hashCell);

    tbody.appendChild(row);
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('.connect-wallet').addEventListener('click', connectWallet);
    document.getElementById('startBot').addEventListener('click', startBot);
    document.getElementById('stopBot').addEventListener('click', stopBot);
    document.querySelector('.swap-button').addEventListener('click', async () => {
        if (!isConnected) {
            alert('Please connect your wallet first.');
            return;
        }
        initContracts();
        await performSwap();
    });
});