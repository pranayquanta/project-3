/* ---------- simple screen flow (no mic until Screen 4) ---------- */
const s1 = document.getElementById('screen1');
const s2 = document.getElementById('screen2');
const s3 = document.getElementById('screen3');
const s4 = document.getElementById('screen4');
const btn1 = document.getElementById('btn1');
const btn2 = document.getElementById('btn2');
const btn3 = document.getElementById('btn3');

const trainSfx = new Audio('./assets/train.mp3');
const sparksSfx = new Audio('./assets/sparks.mp3');

function show(el) {
  [s1, s2, s3, s4].forEach(x => {
    if (!x) return;
    if (x === el) { x.removeAttribute('hidden'); }
    else { x.setAttribute('hidden', ''); }
  });
}


btn1.addEventListener('click', async () => {
  new Audio('assets/train.mp3').play();
  await fadeTo(s2);
});

btn2.addEventListener('click', async () => {
  new Audio('assets/sparks.mp3').play();
  await fadeTo(s3);
});

btn3.addEventListener('click', async () => {
  await fadeTo(s4);
  startMicAndRun();        // <— start audio + visuals here
});


/* ----------------------------------------------------
   Screen 4: your existing mic + layers visual
---------------------------------------------------- */
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let audioCtx, analyser, dataArray;
const FFT_SIZE = 1024;
const TILE_OVERLAP = 5;

const BAND_RANGES = {
  mountains06: [1500, 8000],
  clouds05: [751, 1500],
  house04: [750, 751],
  road02: [50, 750]
};
let bandBins;

const PATHS = {
  mountains06: "assets/mountains06.png",
  clouds05: "assets/clouds05.png",
  house04: "assets/house04.png",
  road02: "assets/road02.png",
  birds03: "assets/birds03.png",
  train00: "assets/train00.png",
  bg07: "assets/bg07.png",
  sun01: "assets/sun01.png"
};

const layers = [
  { key: "mountains06", img: null, x: -800, w: 0, h: 0, y: 0, speed: 0 },
  { key: "clouds05", img: null, x: -800, w: 0, h: 0, y: 0, speed: 0 },
  { key: "house04", img: null, x: -800, w: 0, h: 0, y: 0, speed: 0 },
  { key: "road02", img: null, x: -800, w: 0, h: 0, y: 0, speed: 0 }
];

const CLAP_THRESHOLD = 70;
const birds = [];
const BIRDS_SINE_AMP = 28, BIRDS_SINE_SPEED = 6.0;
let prevOverall = 0;

const BG = "#000";
let lastTime = 0, _dt = 0;

let birdsImg = null, trainImg = null;
const staticBg = { img: null, x: -700, w: 0, h: 0, y: 0 };
const staticSun = { img: null, x: -550, w: 0, h: 0, y: 0 };


function loadImages(done) {
  let left = Object.keys(PATHS).length;
  for (const k in PATHS) {
    const img = new Image();
    img.onload = () => { if (--left === 0) done(); };
    img.src = PATHS[k];
    if (k === "birds03") birdsImg = img;
    else if (k === "train00") trainImg = img;
    else if (k === "bg07") staticBg.img = img;
    else if (k === "sun01") staticSun.img = img;
    else {
      const L = layers.find(o => o.key === k);
      if (L) L.img = img;
    }
  }
}

function fitCanvasAndPlace() {
  canvas.width = innerWidth; canvas.height = innerHeight;
  const targetH = 710;
  layers.forEach(L => {
    if (!L.img) return;
    const s = targetH / L.img.height;
    L.h = targetH; L.w = Math.round(L.img.width * s);
    L.y = Math.round((canvas.height - L.h) / 2) - 37;
  });
  const mountains = layers[0];
  if (mountains) {
    if (staticBg.img) {
      const s = targetH / staticBg.img.height;
      staticBg.h = targetH; staticBg.w = Math.round(staticBg.img.width * s);
      staticBg.y = mountains.y + 5;
    }
    if (staticSun.img) {
      const s = targetH / staticSun.img.height;
      staticSun.h = targetH; staticSun.w = Math.round(staticSun.img.width * s);
      staticSun.y = mountains.y + 4;
    }
  }
}
addEventListener('resize', fitCanvasAndPlace);

function getLayer(key) { return layers.find(l => l.key === key); }

function drawSeamless(L) {
  if (!L || !L.img) return;
  const step = Math.max(1, L.w - TILE_OVERLAP);
  let startX = L.x % step; if (startX > 0) startX -= step;
  for (let x = startX; x < canvas.width; x += step) {
    ctx.drawImage(L.img, x, L.y, L.w, L.h);
  }
}

/* --- music toggle button --- */
const musicBtn = document.getElementById('musicBtn');
const bgSong = document.getElementById('bgSong');
let songPlaying = false;

if (musicBtn && bgSong) {
  musicBtn.addEventListener('click', () => {
    try {
      if (songPlaying) {
        // stop and reset
        bgSong.pause();
        bgSong.currentTime = 0;
        songPlaying = false;
      } else {
        // (re)start from beginning
        bgSong.currentTime = 0;
        bgSong.play();
        songPlaying = true;
      }
    } catch (e) {
      console.error(e);
    }
  });

  // when song ends, update state so next click plays again
  bgSong.addEventListener('ended', () => { songPlaying = false; });
}


function freqToBin(hz) {
  const binWidth = audioCtx.sampleRate / FFT_SIZE;
  const bin = Math.round(hz / binWidth);
  const max = analyser.frequencyBinCount - 1;
  return Math.max(0, Math.min(max, bin));
}
function computeBandBins() {
  bandBins = {
    mountains06: [freqToBin(BAND_RANGES.mountains06[0]), freqToBin(BAND_RANGES.mountains06[1])],
    clouds05: [freqToBin(BAND_RANGES.clouds05[0]), freqToBin(BAND_RANGES.clouds05[1])],
    house04: [freqToBin(BAND_RANGES.house04[0]), freqToBin(BAND_RANGES.house04[1])],
    road02: [freqToBin(BAND_RANGES.road02[0]), freqToBin(BAND_RANGES.road02[1])]
  };
}
function avgBand([a, b]) {
  let sum = 0, n = 0; for (let i = a; i <= b; i++) { sum += dataArray[i]; n++; }
  return n ? sum / n : 0;
}

function spawnBird() {
  if (!birdsImg) return;
  const s = 710 / birdsImg.height;
  const w = Math.round(birdsImg.width * s), h = 710;
  birds.push({ x: 1920, baseY: Math.round((canvas.height - h) / 2 + h * 0.02), w, h, phase: 0 });
}

function updateAndDrawBirds(dt) {
  if (!birdsImg) return;
  const speed = canvas.width / 2;
  for (let i = birds.length - 1; i >= 0; i--) {
    const b = birds[i];
    b.x -= speed * dt; b.phase += BIRDS_SINE_SPEED * dt;
    const y = b.baseY + Math.sin(b.phase) * BIRDS_SINE_AMP;
    ctx.drawImage(birdsImg, b.x, y, b.w, b.h);
    if (b.x + b.w < 0) birds.splice(i, 1);
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (staticBg.img) ctx.drawImage(staticBg.img, staticBg.x, staticBg.y, staticBg.w, staticBg.h);
  drawSeamless(getLayer('mountains06'));
  if (staticSun.img) ctx.drawImage(staticSun.img, staticSun.x, staticSun.y, staticSun.w, staticSun.h);
  drawSeamless(getLayer('clouds05'));
  drawSeamless(getLayer('house04'));
  drawSeamless(getLayer('road02'));
  updateAndDrawBirds(_dt);

  if (trainImg) {
    const fw = 1920, fh = 1080, fx = -30, fy = -20;
    ctx.drawImage(trainImg, fx, fy, fw, fh);
  }
}

function tick(now) {
  requestAnimationFrame(tick);
  _dt = (now - lastTime) / 1000 || 0; lastTime = now;

  if (analyser) {
    analyser.getByteFrequencyData(dataArray);
    for (const L of layers) {
      const avg = avgBand(bandBins[L.key]);
      const pxPerSec = (avg / 255) * 300;
      L.speed = pxPerSec;
      L.x += L.speed * _dt;
    }
    let sum = 0; for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const overall = sum / dataArray.length;
    if (overall > CLAP_THRESHOLD && prevOverall <= CLAP_THRESHOLD) spawnBird();
    prevOverall = overall;
  }
  draw();
}

function startMicAndRun() {
  loadImages(() => { fitCanvasAndPlace(); });
  (async () => {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state !== 'running') await audioCtx.resume();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      computeBandBins();
      lastTime = performance.now();
      requestAnimationFrame(tick);
    } catch (e) {
      alert('Microphone access is required.');
      console.error(e);
    }
  })();
}

// Fade current screen out (0.75s) then fade next screen in (0.75s).
async function fadeTo(nextEl) {
  const cur = document.querySelector('.screen:not([hidden])');
  if (cur === nextEl) return;

  // 1) fade out current
  cur.style.opacity = '1';
  await new Promise(r => {
    requestAnimationFrame(() => {        // ensure style is applied first
      cur.style.opacity = '0';
      setTimeout(r, 750);                // wait .75s
    });
  });
  cur.setAttribute('hidden', '');         // fully hide after fade

  // 2) fade in next
  nextEl.style.opacity = '0';            // start from transparent
  nextEl.removeAttribute('hidden');
  await new Promise(r => {
    requestAnimationFrame(() => {
      nextEl.style.opacity = '1';
      setTimeout(r, 750);                // wait .75s
    });
  });
}


/* boot (preload images & size canvas; stays on Screen 1 until clicks) */
loadImages(() => { fitCanvasAndPlace(); });
