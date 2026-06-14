// Popup script for The CANADA List Extension

const statusMessage = document.getElementById('status-message');
const refreshBtn = document.getElementById('refresh-btn');
const statsBtn = document.getElementById('stats-btn');

/**
 * Update status message with cache info
 */
async function updateStatus() {
  try {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['canadaListData', 'canadaListDataExpiry'], resolve);
    });

    const data = result.canadaListData;
    const expiry = result.canadaListDataExpiry;

    if (data && expiry) {
      const now = Date.now();
      const hoursUntilExpiry = Math.floor((expiry - now) / (1000 * 60 * 60));
      statusMessage.innerHTML = `
        ✓ Data loaded successfully<br>
        <small>${data.length} products cached</small><br>
        <small>Expires in ${hoursUntilExpiry} hours</small>
      `;
      statusMessage.className = 'status-success';
    } else {
      statusMessage.textContent = 'No cached data found. Click "Refresh Data" to load.';
      statusMessage.className = 'status-warning';
    }
  } catch (error) {
    statusMessage.textContent = 'Error loading status';
    statusMessage.className = 'status-error';
    console.error('Status check error:', error);
  }
}

/**
 * Handle refresh button click
 */
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '⟳ Refreshing...';
  statusMessage.textContent = 'Fetching latest data...';
  statusMessage.className = 'status-loading';

  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'refreshData' }, resolve);
    });
    await updateStatus();
    refreshBtn.textContent = '✓ Refreshed!';
    setTimeout(() => {
      refreshBtn.textContent = '🔄 Refresh Data';
      refreshBtn.disabled = false;
    }, 2000);
  } catch (error) {
    statusMessage.textContent = 'Failed to refresh data';
    statusMessage.className = 'status-error';
    refreshBtn.textContent = '🔄 Refresh Data';
    refreshBtn.disabled = false;
    console.error('Refresh error:', error);
  }
});

/**
 * Handle stats button click
 */
statsBtn.addEventListener('click', async () => {
  try {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['canadaListData'], resolve);
    });

    const data = result.canadaListData || [];
    
    if (data.length === 0) {
      alert('No data available. Please refresh first.');
      return;
    }

    // Calculate stats
    const scoreDistribution = {
      10: 0, 9: 0, 8: 0, 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0
    };

    const ownershipCounts = {};
    let totalScore = 0;

    data.forEach((product) => {
      const score = product['CANADIAN Score (out of 10)'];
      scoreDistribution[score]++;
      totalScore += score;

      const ownership = product['Ownership (Country)'];
      ownershipCounts[ownership] = (ownershipCounts[ownership] || 0) + 1;
    });

    const avgScore = (totalScore / data.length).toFixed(2);
    const canadianProducts = ownershipCounts['Canada'] || 0;
    const canadianPercentage = ((canadianProducts / data.length) * 100).toFixed(1);

    let statsText = `📊 CANADA List Statistics\n\n`;
    statsText += `Total Products: ${data.length}\n`;
    statsText += `Average Score: ${avgScore}/10\n`;
    statsText += `Canadian-owned: ${canadianProducts} (${canadianPercentage}%)\n\n`;
    statsText += `Score Distribution:\n`;
    for (let score = 10; score >= 1; score--) {
      statsText += `${score}/10: ${scoreDistribution[score]} products\n`;
    }

    alert(statsText);
  } catch (error) {
    alert('Error loading statistics');
    console.error('Stats error:', error);
  }
});

// Initialize on popup open
updateStatus();
