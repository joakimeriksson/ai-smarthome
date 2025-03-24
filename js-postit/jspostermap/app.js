const canvas = document.getElementById("posterCanvas");
const ctx = canvas.getContext("2d");
const fontCfg = "26px Calibri, sans-serif";
const lineHeight = 30;
// For the tab on wrapped lines
const tabWidth = 46;

let image = new Image();
let positions = [];
let posters = [];
let lineSpacing = 8;

document.getElementById("imageLoader").addEventListener("change", function(e) {
  const reader = new FileReader();
  reader.onload = function(event) {
    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      drawAll();
    };
    image.src = event.target.result;
  };
  reader.readAsDataURL(e.target.files[0]);
});

document.getElementById("configLoader").addEventListener("change", function(e) {
    const reader = new FileReader();
    reader.onload = function(event) {
      try {
        const config = jsyaml.load(event.target.result);
        if (config.positions) positions = config.positions;
        if (config.posters) posters = config.posters;
        if (config.linespacing) lineSpacing = config.linespacing;
        drawAll();
      } catch (e) {
        alert("Invalid YAML file");
        console.error(e);
      }
    };
    reader.readAsText(e.target.files[0]);
  });

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(e.clientX - rect.left);
  const y = Math.round(e.clientY - rect.top);
  positions.push({ x, y });
  drawAll();
});

const boxes = [
  { x: 40, y: 1400, width: 960, height: 380 },
  { x: 1060, y: 1400, width: 960, height: 380 },
  { x: 2080, y: 1400, width: 960, height: 380 },
  { x: 700, y: 40, width: 960, height: 970 },
  { x: 1950, y: 40, width: 960, height: 970 }
];

function drawAll() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
  
    positions.forEach((pos, index) => {
      drawCircle(pos.x, pos.y, index + 1);
    });
  
    drawPosters();
  }

function drawCircle(x, y, label) {
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, 2 * Math.PI, false);
  ctx.fillStyle = "rgba(200, 222, 255, 0.8)";
  ctx.fill();
//  ctx.lineWidth = 1;
//  ctx.strokeStyle = "#000";
//  ctx.stroke();

  ctx.fillStyle = "#000";
  ctx.font = fontCfg;
  ctx.fillText(label, x - 10, y + 5);
}

function drawPosters() {
  const sortedPosters = posters.slice().sort((a, b) => a.position - b.position);
  let boxIndex = 0;
  let xpos = boxes[boxIndex].x + 4;
  let ypos = boxes[boxIndex].y + 4;
  let boxRight = boxes[boxIndex].x + boxes[boxIndex].width;
  let boxBottom = boxes[boxIndex].y + boxes[boxIndex].height;


  // Draw the translucent boxes
  boxes.forEach(box => {
    ctx.fillStyle = "rgba(210, 210, 255, 0.5)";
    ctx.fillRect(box.x, box.y, box.width, box.height);
  });

  sortedPosters.forEach((poster, idx) => {
    const text = `${poster.position}: ${poster.name}`;
    const words = text.split(' ');
    let line = "";

    ctx.font = fontCfg;
    ctx.fillStyle = "#000";
    let wrapped = false;
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (xpos + testWidth > boxRight) {
          ctx.fillText(line, xpos + (wrapped ? tabWidth : 0), ypos + lineHeight - 6);
          wrapped = false;
          line = words[n] + " ";
          ypos += lineHeight;
          xpos = boxes[boxIndex].x + 4;
          wrapped = true;

          if (ypos + lineHeight > boxBottom) {
            boxIndex++;
            if (boxIndex >= boxes.length) return;
            xpos = boxes[boxIndex].x + 4;
            ypos = boxes[boxIndex].y + 4;
            boxRight = boxes[boxIndex].x + boxes[boxIndex].width;
            boxBottom = boxes[boxIndex].y + boxes[boxIndex].height;
          }
        } else {
          line = testLine;
        }
    }
    if (line) {
        ctx.fillText(line.trim(), xpos + (wrapped ? tabWidth : 0), ypos + lineHeight - 6);
        ypos += lineHeight;
  
        if (ypos + lineHeight > boxBottom) {
          boxIndex++;
          if (boxIndex < boxes.length) {
            xpos = boxes[boxIndex].x + 4;
            ypos = boxes[boxIndex].y + 4;
            boxRight = boxes[boxIndex].x + boxes[boxIndex].width;
            boxBottom = boxes[boxIndex].y + boxes[boxIndex].height;
          }
        }
      }
  });
}

document.addEventListener("DOMContentLoaded", () => {
    const exportButton = document.createElement("button");
    exportButton.textContent = "Export Positions";
    exportButton.style.marginTop = "10px";
    document.body.appendChild(exportButton);
  
    exportButton.addEventListener("click", downloadPositions);
  });
  
  function downloadPositions() {
    const yamlContent = jsyaml.dump({ positions }, { forceQuotes: false });
    const blob = new Blob([yamlContent], { type: "text/yaml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "positions.yaml";
    link.click();
  }