/* Simon Neon — modern rebuild
   - Start/Pause/Restart controls
   - Strict mode, speed settings
   - WebAudio tones
   - Keyboard controls (Enter, R, 1-4, arrows)
   - Hint (replay sequence once; costs streak)
   - High score localStorage
*/

(() => {
  // ---------- DOM ----------
  const pads = [...document.querySelectorAll(".pad")];
  const panel = document.querySelector(".panel");

  const startBtn = document.getElementById("startBtn");
  const startBtnLabel = document.getElementById("startBtnLabel");
  const pauseBtn = document.getElementById("pauseBtn");
  const restartBtn = document.getElementById("restartBtn");
  const hintBtn = document.getElementById("hintBtn");
  const howBtn = document.getElementById("howBtn");

  const speedSelect = document.getElementById("speedSelect");
  const strictToggle = document.getElementById("strictToggle");
  const soundToggle = document.getElementById("soundToggle");

  const levelValue = document.getElementById("levelValue");
  const bestValue = document.getElementById("bestValue");
  const streakValue = document.getElementById("streakValue");
  const inputValue = document.getElementById("inputValue");
  const message = document.getElementById("message");
  const tinyNote = document.getElementById("tinyNote");

  const modal = document.getElementById("modal");
  const closeModalBtn = document.getElementById("closeModalBtn");

  // ---------- Game State ----------
  const COLORS = ["red", "yellow", "green", "blue"];

  let gameSeq = [];
  let userIdx = 0;

  let started = false;
  let paused = false;
  let acceptingInput = false;

  let level = 0;
  let streak = 0;

  let seqToken = 0; // increments whenever we start a new playback
  let isPlaying = false;

  const BEST_KEY = "simon_neon_best";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);

  // speed profiles (ms)
  const SPEEDS = {
    easy: { flash: 460, gap: 180 },
    normal: { flash: 360, gap: 160 },
    hard: { flash: 280, gap: 140 },
    insane: { flash: 120, gap: 20 },
  };

  // ---------- Audio (WebAudio) ----------
  let audioCtx = null;

  const FREQ = {
    red: 196.0, // G3
    yellow: 246.94, // B3
    green: 293.66, // D4
    blue: 392.0, // G4
    fail: 110.0,
    win: 523.25, // C5
  };

  function ensureAudio() {
    if (!soundToggle.checked) return;
    if (!audioCtx)
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function tone(freq, ms, type = "sine", gainVal = 0.06) {
    if (!soundToggle.checked) return;
    ensureAudio();
    if (!audioCtx) return;

    const t0 = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);

    // quick ADSR-ish envelope
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainVal, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }

  function clickTone(color, ms) {
    tone(FREQ[color], ms, "triangle", 0.07);
  }

  function failTone() {
    tone(FREQ.fail, 320, "sawtooth", 0.09);
  }

  function winTone() {
    tone(FREQ.win, 140, "sine", 0.07);
    setTimeout(() => tone(659.25, 140, "sine", 0.06), 130);
  }

  // ---------- Helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getSpeed() {
    return SPEEDS[speedSelect.value] || SPEEDS.normal;
  }

  function setMsg(text) {
    message.innerHTML = text;
  }

  function setTiny(text) {
    tinyNote.textContent = text;
  }

  function padEl(color) {
    return pads.find((p) => p.dataset.color === color);
  }

  function updateHUD() {
    levelValue.textContent = String(level);
    bestValue.textContent = String(best);
    streakValue.textContent = String(streak);

    inputValue.textContent = `${Math.min(userIdx, gameSeq.length)} / ${gameSeq.length}`;
  }

  function setButtons() {
    startBtnLabel.textContent = !started
      ? "Start"
      : paused
        ? "Resume"
        : "Running";
    startBtn.disabled = started && !paused;
    pauseBtn.disabled = !started;
    restartBtn.disabled = !started;
    hintBtn.disabled = !started || paused || isPlaying;
  }

  function setPadsEnabled(enabled) {
    pads.forEach((p) => (p.disabled = !enabled));
  }

  function hardResetUI() {
    panel.classList.remove("is-shaking");
    pads.forEach((p) => p.classList.remove("is-lit", "is-pressed"));
  }

  // ---------- Pad FX ----------
  async function flashPad(color, ms) {
    const el = padEl(color);
    if (!el) return;

    el.classList.add("is-lit");
    clickTone(color, Math.max(120, ms - 40));
    await sleep(ms);
    el.classList.remove("is-lit");
  }

  async function pressPad(color, ms = 140) {
    const el = padEl(color);
    if (!el) return;

    el.classList.add("is-pressed");
    clickTone(color, 120);
    await sleep(ms);
    el.classList.remove("is-pressed");
  }

  // ---------- Game Flow ----------
  function resetState() {
    gameSeq = [];
    userIdx = 0;
    level = 0;
    streak = 0;
    started = false;
    paused = false;
    acceptingInput = false;
    hintAvailable = true;
    hintUsedThisLevel = false;

    updateHUD();
    setButtons();
    setPadsEnabled(false);
  }

  function newRound() {
    userIdx = 0;
    level += 1;

    hintUsedThisLevel = false;
    hintAvailable = true;

    // add one step
    const next = COLORS[Math.floor(Math.random() * COLORS.length)];
    gameSeq.push(next);

    updateHUD();
  }

  async function playSequence() {
    const myToken = ++seqToken; // invalidate any previous runs
    const { flash, gap } = getSpeed();

    isPlaying = true;
    acceptingInput = false;
    setPadsEnabled(false);
    setButtons();

    setMsg(
      `Watch the sequence… <span class="muted">(Level <b>${level}</b>)</span>`,
    );
    setTiny("Focus. Breathe. Repeat.");

    await sleep(350);
    if (myToken !== seqToken || !started || paused) {
      isPlaying = false;
      return;
    }

    for (let i = 0; i < gameSeq.length; i++) {
      if (myToken !== seqToken || !started || paused) {
        isPlaying = false;
        return;
      }
      await flashPad(gameSeq[i], flash);
      await sleep(gap);
    }

    if (myToken !== seqToken || !started || paused) {
      isPlaying = false;
      return;
    }

    isPlaying = false;
    acceptingInput = true;
    setPadsEnabled(true);
    setButtons();
    setMsg(
      `Your turn: repeat <b>${gameSeq.length}</b> step${gameSeq.length === 1 ? "" : "s"}.`,
    );
    updateHUD();
  } 

  async function startGame() {
    ensureAudio();

    if (started && paused) {
      paused = false;
      setMsg("Resumed. Your turn continues.");
      setTiny("You got this.");
      setPadsEnabled(acceptingInput);
      setButtons();
      return;
    }

    // fresh start
    resetState();
    started = true;
    paused = false;
    setButtons();

    setMsg("Let’s go! Memorize the first step.");
    setTiny("Tip: Use 1–4 keys for speed.");

    await sleep(300);

    newRound();
    updateHUD();
    setButtons();
    await playSequence();
  }

  function pauseGame() {
    if (!started) return;
    paused = !paused;

    if (paused) {
      setMsg("Paused. Press <kbd>Enter</kbd> or <b>Resume</b> to continue.");
      setTiny("Paused");
      setPadsEnabled(false);
    } else {
      setMsg(
        acceptingInput ? "Back! Continue your turn." : "Back! Watch carefully…",
      );
      setTiny("Resumed");
      setPadsEnabled(acceptingInput);
    }

    setButtons();
  }

  async function restartGame() {
    if (!started) return;
    setMsg("Restarting…");
    setTiny("Resetting pattern");
    await sleep(200);

    resetState();
    started = true;
    setButtons();
    await sleep(200);

    newRound();
    updateHUD();
    setButtons();
    await playSequence();
  }

  async function gameOver(reason = "Wrong move") {
    acceptingInput = false;
    setPadsEnabled(false);

    panel.classList.add("is-shaking");
    failTone();

    setMsg(
      `<b>Game Over</b> — ${reason}. Press <kbd>Start</kbd> or <kbd>Enter</kbd> to try again.`,
    );
    setTiny("Oof. Run it back.");

    // best score uses *level reached*, so compare level
    if (level > best) {
      best = level;
      localStorage.setItem(BEST_KEY, String(best));
      winTone();
      setTiny("New best! 🔥");
    }

    updateHUD();

    // mark as stopped
    started = false;
    paused = false;
    setButtons();

    // clean UI after shake
    setTimeout(() => panel.classList.remove("is-shaking"), 520);
  }

  async function handleUserInput(color) {
    if (!started || paused || !acceptingInput || isPlaying) return;

    await pressPad(color);

    const expected = gameSeq[userIdx];
    const correct = color === expected;

    userIdx += 1;
    updateHUD();

    if (!correct) {
      if (strictToggle.checked) {
        await gameOver("Strict mode mistake");
      } else {
        // non-strict: replay sequence, keep level but reset input
        streak = Math.max(0, streak - 1);
        userIdx = 0;
        updateHUD();

        setMsg("Not quite. Watch again and retry this level.");
        setTiny("Non-strict retry");
        await sleep(450);
        acceptingInput = false;
        setPadsEnabled(false);
        setButtons();
        await playSequence();
      }
      return;
    }

    // still correct so far
    if (userIdx === gameSeq.length) {
      // level complete
      acceptingInput = false;
      setPadsEnabled(false);

      streak += 1;
      updateHUD();

      setMsg(`Nice! Level <b>${level}</b> cleared.`);
      setTiny(streak >= 3 ? "Hot streak 🔥" : "Clean.");

      winTone();

      await sleep(650);
      newRound();
      updateHUD();
      setButtons();
      await playSequence();
    }
  }

  async function hint() {
    if (!started || paused || isPlaying) return;

    // optional: keep the cost
    streak = 0;
    updateHUD();

    setMsg("Hint: replaying the sequence…");
    setTiny("Streak reset");
    await sleep(200);
    await playSequence();
  }

  // ---------- Events ----------
  startBtn.addEventListener("click", startGame);
  pauseBtn.addEventListener("click", pauseGame);
  restartBtn.addEventListener("click", restartGame);
  hintBtn.addEventListener("click", hint);

  pads.forEach((p) => {
    p.addEventListener("click", () => handleUserInput(p.dataset.color));
  });

  // Modal
  function openModal() {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    closeModalBtn.focus();
  }
  function closeModal() {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
    howBtn.focus();
  }

  howBtn.addEventListener("click", openModal);
  closeModalBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target && e.target.dataset && e.target.dataset.close === "true")
      closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (modal.classList.contains("show") && e.key === "Escape") closeModal();
  });

  // Keyboard
  document.addEventListener(
    "keydown",
    (e) => {
      const key = e.key.toLowerCase();

      // prevent scrolling with arrows when playing
      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)
      ) {
        e.preventDefault();
      }

      if (key === "enter") {
        if (!started) startGame();
        else pauseGame();
        return;
      }

      if (key === "r") {
        if (started) restartGame();
        return;
      }

      // 1-4 pad mapping
      if (["1", "2", "3", "4"].includes(key)) {
        const map = { 1: "red", 2: "yellow", 3: "green", 4: "blue" };
        handleUserInput(map[key]);
        return;
      }

      // Arrow mapping (optional)
      // left=red, up=yellow, down=green, right=blue
      const arrowMap = {
        arrowleft: "red",
        arrowup: "yellow",
        arrowdown: "green",
        arrowright: "blue",
      };
      if (arrowMap[key]) handleUserInput(arrowMap[key]);
    },
    { passive: false },
  );

  // Settings changes
  speedSelect.addEventListener("change", () => {
    setTiny(`Speed set to ${speedSelect.value.toUpperCase()}`);
  });

  soundToggle.addEventListener("change", () => {
    if (soundToggle.checked) ensureAudio();
    setTiny(soundToggle.checked ? "Sound on" : "Sound off");
  });

  strictToggle.addEventListener("change", () => {
    setTiny(
      strictToggle.checked ? "Strict mode enabled" : "Strict mode disabled",
    );
  });

  // ---------- Init ----------
  bestValue.textContent = String(best);
  resetState();
  setMsg(
    `Press <kbd>Start</kbd> or hit <kbd>Enter</kbd>. Use <kbd>1–4</kbd> to play.`,
  );
})();
