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
        if (!window.ethereum) {
            alert('MetaMask is not installed. Please install MetaMask and try again.');
            return;
        }

        // Add Monad Testnet if not already added
        await addMonadTestnet();

        // Connect to MetaMask
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();

        isConnected = true;

        // Update UI
        document.querySelector('.wallet-text').textContent = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
        document.querySelector('.connect-wallet').disabled = true;

        console.log('Connected to MetaMask:', userAddress);
    } catch (error) {
        console.error('Error connecting to MetaMask:', error);
        alert('Failed to connect to MetaMask. Please try again.');
    }
}

// Add Monad Testnet to MetaMask
async function addMonadTestnet() {
    try {
        await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
                chainId: '0x279F', // 10143 in hex
                chainName: 'Monad Testnet',
                nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
                rpcUrls: ['https://testnet-rpc.monad.xyz'],
                blockExplorerUrls: ['https://testnet.monadexplorer.com'],
            }],
        });
    } catch (error) {
        console.log('Monad Testnet already added or error:', error);
    }
}

// Initialize contracts
function initContracts() {
    const routerAddress = document.getElementById('routerAddress').value;
    const tokenAddress = document.getElementById('tokenAddress').value;
    routerContract = new ethers.Contract(routerAddress, routerAbi, signer);
    tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer);
}

// Perform swap (buy or sell)
async function performSwap() {
    try {
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
function startBot() {
    if (!isConnected) {
        alert('Please connect your wallet first.');
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

    botInterval = setInterval(performSwap, intervalMs);
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