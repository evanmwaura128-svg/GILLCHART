import { scanCanvasForCandles } from './rules/lesson1_structure.js';
import { generateTradeSetup, renderDashboardSignals } from './rules/trade_generator.js';

const fileInput = document.getElementById('file-input');
const clearButton = document.getElementById('clear-button');
const chartStage = document.getElementById('chart-stage');
const uploadPrompt = document.getElementById('upload-prompt');
const chartCanvas = document.getElementById('chart-canvas');
const chartFilename = document.getElementById('chart-filename');
const imageDimensions = document.getElementById('image-dimensions');
const chartContext = chartCanvas.getContext('2d');

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
      .then((marketData) => generateTradeSetup(marketData, chartCanvas, chartContext))
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
