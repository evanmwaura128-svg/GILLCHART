import { scanCanvasForCandles } from './lesson1_structure.js';
import { generateTradeSetup, renderDashboardSignals } from './trade_generator.js';

let backtestHistory = [];

const fileInput = document.getElementById('file-input');
const clearButton = document.getElementById('clear-button');
const chartStage = document.getElementById('chart-stage');
const uploadPrompt = document.getElementById('upload-prompt');
const chartCanvas = document.getElementById('chart-canvas');
const chartFilename = document.getElementById('chart-filename');
const imageDimensions = document.getElementById('image-dimensions');
const chartContext = chartCanvas.getContext('2d');

function renderBacktestStats() {
  const statsElement = document.querySelector('.backtest-stats');
  if (!statsElement) return;

  const wins = backtestHistory.filter((trade) => trade.status === 'WIN').length;
  const losses = backtestHistory.filter((trade) => trade.status === 'LOSS').length;
  const totalTrades = backtestHistory.length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : '0.00';
  statsElement.innerHTML = `<b>Backtest Performance:</b> Total Trades: ${totalTrades} | Wins: ${wins} | Losses: ${losses} | Win Rate: ${winRate}%`;
}

function recordBacktestResult(setup) {
  const liveClose = setup.currentPrice;
  const { entry, takeProfit, stopLoss } = setup;
  if (Number.isFinite(liveClose) && Number.isFinite(entry)
    && Number.isFinite(takeProfit) && Number.isFinite(stopLoss)) {
    if (liveClose >= takeProfit) {
      backtestHistory.push({ status: 'WIN', profit: takeProfit - entry });
    } else if (liveClose <= stopLoss) {
      backtestHistory.push({ status: 'LOSS', loss: entry - stopLoss });
    }
  }
  renderBacktestStats();
}

function loadChartImage(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return;

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  image.onload = () => {
    chartCanvas.width = image.naturalWidth;
    chartCanvas.height = image.naturalHeight;
    chartContext.drawImage(image, 0, 0);
    chartCanvas.hidden = false;
    uploadPrompt.hidden = true;
    chartFilename.textContent = file.name;
    imageDimensions.textContent = `${image.naturalWidth} × ${image.naturalHeight} PX`;
    clearButton.disabled = false;
    scanCanvasForCandles(chartCanvas, chartContext)
      .then((marketData) => {
        const setup = generateTradeSetup(marketData, chartCanvas, chartContext);
        recordBacktestResult(setup);
        return setup;
      })
      .catch((error) => console.error('Chart analysis failed:', error));
    URL.revokeObjectURL(objectUrl);
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
  };

  image.src = objectUrl;
}

function resetChart() {
  chartContext.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
  chartCanvas.width = 0;
  chartCanvas.height = 0;
  chartCanvas.hidden = true;
  uploadPrompt.hidden = false;
  chartFilename.textContent = 'NO CHART LOADED';
  imageDimensions.textContent = '-- × -- PX';
  clearButton.disabled = true;
  fileInput.value = '';
  renderDashboardSignals('WAITING FOR BREAKOUT', null, null, null, chartCanvas, chartContext);
}

uploadPrompt.addEventListener('click', () => fileInput.click());
uploadPrompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => loadChartImage(fileInput.files[0]));
clearButton.addEventListener('click', resetChart);

chartStage.addEventListener('dragover', (event) => {
  event.preventDefault();
  chartStage.classList.add('is-dragging');
});

chartStage.addEventListener('dragleave', (event) => {
  if (!chartStage.contains(event.relatedTarget)) chartStage.classList.remove('is-dragging');
});

chartStage.addEventListener('drop', (event) => {
  event.preventDefault();
  chartStage.classList.remove('is-dragging');
  loadChartImage(event.dataTransfer.files[0]);
});
