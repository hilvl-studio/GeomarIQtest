/* ============================================================
   GEOMAR GULF LLC — IQ ASSESSMENT PLATFORM
   questions.js — Engine Logic, Anti-Cheat & Telegram Integration
   ============================================================ */

'use strict';

/* ===== CONFIGURATION ===== */
const TELEGRAM_BOT_TOKEN = "8983686015:AAEjimFk4BkXzdFcBUDneYL4iBVFcB5q05k";
const TELEGRAM_CHAT_ID = "-1004394363945";

/* ===== PUZZLEBOT / NOCODB WEBHOOK ===== */
const WEBHOOK_URL = "L5nNg5rKtkkgEieu3CZeWqBxE9V3aLZv";

/* ===== STATE VARIABLES ===== */
let currentQuestion      = 0;
let answers              = [];
let timerInterval        = null;
let totalTimeLeft        = 2700;   // 45 minutes in seconds
let candidateFirstName   = '';
let candidateLastName    = '';
let candidatePhone       = '';
let candidateDesignation = '';
let testRunning          = false;
let anticheatArmed       = false;
let telegramSent         = false;
let webhookSent          = false;
let choicesLocked        = false;

/* ===== QUESTION DATABASE =====
   Each entry maps to test-images/[n].webp with its strict answer key.
   Answer key: 1-f, 2-b, 3-a, 4-c, 5-d, 6-b, 7-f, 8-a, 9-d, 10-f,
               11-d, 12-b, 13-e, 14-d, 15-b, 16-d, 17-b, 18-c, 19-d,
               20-b, 21-c, 22-b, 23-b, 24-f, 25-f
   ============================================================ */
const QUESTIONS = [
  { image: 'test-images/1.webp',  answer: 'f' },
  { image: 'test-images/2.webp',  answer: 'b' },
  { image: 'test-images/3.webp',  answer: 'a' },
  { image: 'test-images/4.webp',  answer: 'c' },
  { image: 'test-images/5.webp',  answer: 'd' },
  { image: 'test-images/6.webp',  answer: 'b' },
  { image: 'test-images/7.webp',  answer: 'f' },
  { image: 'test-images/8.webp',  answer: 'a' },
  { image: 'test-images/9.webp',  answer: 'd' },
  { image: 'test-images/10.webp', answer: 'f' },
  { image: 'test-images/11.webp', answer: 'd' },
  { image: 'test-images/12.webp', answer: 'b' },
  { image: 'test-images/13.webp', answer: 'e' },
  { image: 'test-images/14.webp', answer: 'd' },
  { image: 'test-images/15.webp', answer: 'b' },
  { image: 'test-images/16.webp', answer: 'd' },
  { image: 'test-images/17.webp', answer: 'b' },
  { image: 'test-images/18.webp', answer: 'c' },
  { image: 'test-images/19.webp', answer: 'd' },
  { image: 'test-images/20.webp', answer: 'b' },
  { image: 'test-images/21.webp', answer: 'c' },
  { image: 'test-images/22.webp', answer: 'b' },
  { image: 'test-images/23.webp', answer: 'b' },
  { image: 'test-images/24.webp', answer: 'f' },
  { image: 'test-images/25.webp', answer: 'f' },
];

/* ===== DOM REFERENCES ===== */
const SCREENS = {
  blocked:   document.getElementById('screen-blocked'),
  legal:     document.getElementById('screen-legal'),
  profile:   document.getElementById('screen-profile'),
  camera:    document.getElementById('screen-camera'),
  countdown: document.getElementById('screen-countdown'),
  test:      document.getElementById('screen-test'),
  timesup:   document.getElementById('screen-timesup'),
  submit:    document.getElementById('screen-submit'),
  final:     document.getElementById('screen-final'),
};

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

/**
 * Hide all screens, then reveal the requested one.
 */
function showScreen(name) {
  Object.values(SCREENS).forEach(function(el) {
    if (el) el.classList.add('hidden');
  });
  if (SCREENS[name]) {
    SCREENS[name].classList.remove('hidden');
  }
}

/**
 * Silent background Telegram webhook transmission.
 *
 * Uses application/x-www-form-urlencoded — a "simple" CORS request
 * that requires no preflight, ensuring maximum delivery reliability
 * across all browser environments including file:// origins.
 *
 * URL constructed via manual string concatenation (no template literals).
 */
function sendTelegram(message) {
  if (telegramSent) return;
  telegramSent = true;

  var url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';

  /* Build URL-encoded body — avoids JSON Content-Type CORS preflight */
  var body = 'chat_id=' + encodeURIComponent(TELEGRAM_CHAT_ID) +
             '&text='   + encodeURIComponent(message);

  /* Primary: fetch API */
  if (typeof fetch === 'function') {
    fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body
    }).catch(function() {
      /* Fallback to XHR on fetch failure */
      _xhrSend(url, body);
    });
  } else {
    /* Fallback for environments without fetch */
    _xhrSend(url, body);
  }
}

/** XHR fallback sender */
function _xhrSend(url, body) {
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.send(body);
  } catch (e) { /* silent */ }
}

/**
 * PuzzleBot / NocoDB webhook transmission.
 *
 * Fires a JSON POST to WEBHOOK_URL in parallel with the Telegram notification.
 * Field names are case-sensitive and match the NocoDB table schema exactly:
 *   - "Date"      → current local date/time string
 *   - "Candidate" → full name (first + last)
 *   - "Phone"     → candidate phone number
 *   - "Score"     → result formatted as "N/25"
 *
 * A webhookSent guard prevents duplicate submissions if concludeAssessment
 * is somehow invoked more than once in the same session.
 *
 * @param {number} score — raw numeric score (0-25)
 */
function sendWebhook(score) {
  if (webhookSent) return;
  webhookSent = true;

  var payload = {
    'Date':      new Date().toLocaleString(),
    'Candidate': candidateFirstName + ' ' + candidateLastName,
    'Phone':     candidatePhone,
    'Score':     score + '/25'
  };

  fetch(WEBHOOK_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  }).catch(function() {
    /* Silent failure — webhook delivery is best-effort and
       must never interrupt the candidate-facing UI flow.    */
  });
}

/**
 * Evaluate recorded answers against the answer key.
 * @returns {number} correct answer count (0-25)
 */
function calculateScore() {
  var score = 0;
  for (var i = 0; i < QUESTIONS.length; i++) {
    if (answers[i] && answers[i] === QUESTIONS[i].answer) {
      score++;
    }
  }
  return score;
}

/* ============================================================
   TIMER ENGINE — 45-Minute Global Countdown
   ============================================================ */

function clearActiveTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/**
 * Render totalTimeLeft into the #timer-value element as MM:SS.
 * Also updates the timer widget background colour:
 *   Green  → default (> 15 min remaining)
 *   Yellow → ≤ 15 minutes remaining
 *   Red    → ≤ 5 minutes remaining
 */
function updateTimerDisplay() {
  var valEl    = document.getElementById('timer-value');
  var widgetEl = document.getElementById('timer-widget');
  if (!valEl || !widgetEl) return;

  var minutes = Math.floor(totalTimeLeft / 60);
  var seconds = totalTimeLeft % 60;
  var display = (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;

  valEl.textContent = display;

  /* Colour state transitions */
  widgetEl.classList.remove('state-yellow', 'state-red');
  if (totalTimeLeft <= 300) {          /* ≤ 5 minutes → Red */
    widgetEl.classList.add('state-red');
  } else if (totalTimeLeft <= 900) {   /* ≤ 15 minutes → Yellow */
    widgetEl.classList.add('state-yellow');
  }
  /* > 15 minutes → default Green (no extra class needed) */
}

/**
 * Start the 45-minute global exam countdown.
 * Decrements totalTimeLeft by 1 every second.
 * When it reaches zero, triggers the global timeout handler.
 */
function startGlobalTimer() {
  clearActiveTimer();

  timerInterval = setInterval(function() {
    totalTimeLeft--;
    updateTimerDisplay();

    if (totalTimeLeft <= 0) {
      clearActiveTimer();
      handleGlobalTimeout();
    }
  }, 1000);
}

/**
 * Called when the 45-minute global timer reaches zero.
 * Shows the TIME IS UP overlay, then concludes the assessment.
 * localStorage is cleared so the candidate may start fresh.
 */
function handleGlobalTimeout() {
  choicesLocked  = true;
  testRunning    = false;
  anticheatArmed = false;

  showScreen('timesup');

  setTimeout(function() {
    concludeAssessment('Time Expired — 45 Minute Limit Reached', true);
  }, 3000);
}

/* ============================================================
   ANTI-CHEAT GLOBAL MONITORS
   ============================================================ */

/* Tab switch / window minimize detection */
document.addEventListener('visibilitychange', function() {
  if (document.hidden && anticheatArmed) {
    terminateByAnticheat();
  }
});

/* Focus loss detection (alt-tab, clicking external apps) */
window.addEventListener('blur', function() {
  if (anticheatArmed) {
    terminateByAnticheat();
  }
});

/* Reload / close interception */
window.addEventListener('beforeunload', function(e) {
  if (testRunning || anticheatArmed) {
    e.preventDefault();
    var msg = 'The assessment is currently in progress. Leaving or refreshing this page will permanently void your assessment session.';
    e.returnValue = msg;
    return msg;
  }
});

/* ============================================================
   ASSESSMENT CONCLUSION
   ============================================================ */

/**
 * Build and dispatch the Telegram result payload AND the PuzzleBot
 * webhook payload in parallel.
 *
 * ── INSERTION POINT ──────────────────────────────────────────
 * The sendWebhook(score) call was added immediately after
 * sendTelegram(msg) inside this function. Both fire concurrently
 * and independently; a failure in one does not affect the other.
 * ─────────────────────────────────────────────────────────────
 *
 * @param {string}  status           — termination status string
 * @param {boolean} skipSubmitScreen — if true, go straight to final screen
 *                                     (used for timer expiry path).
 *                                     if false (default), show the
 *                                     "Submit Results to HR" intermediate screen.
 *
 * localStorage is CLEARED on normal completion and timer expiry so the
 * candidate may open the link again and start a completely fresh session.
 */
function concludeAssessment(status, skipSubmitScreen) {
  testRunning    = false;
  anticheatArmed = false;
  choicesLocked  = true;

  clearActiveTimer();

  var score    = calculateScore();
  var fullName = candidateFirstName + ' ' + candidateLastName;

  /* Clear localStorage so the link is not permanently blocked */
  localStorage.removeItem('test_status');
  localStorage.removeItem('candidate_phone');

  /* ── 1. Telegram group notification (existing logic — unchanged) ── */
  var msg =
    'IQ Assessment Report - Geomar Gulf LLC' + '\n\n'          +
    'Candidate Name: '  + fullName            + '\n'            +
    'Phone Number: '    + candidatePhone       + '\n'            +
    'Designation: '     + candidateDesignation + '\n'            +
    'Final Score: '     + score + ' out of 25' + '\n'            +
    'Status: '          + status;

  sendTelegram(msg);

  /* ── 2. PuzzleBot / NocoDB webhook (new — fires in parallel) ── */
  sendWebhook(score);

  if (skipSubmitScreen) {
    /* Timer-expiry path → go directly to final screen */
    showScreen('final');
  } else {
    /* Normal finish path → show "Submit Results to HR" screen */
    showScreen('submit');
  }
}

/**
 * Anti-cheat termination path — sets voided state and fires Telegram alert.
 * localStorage is intentionally kept as 'voided' to permanently block re-entry
 * after a security infraction.
 */
function terminateByAnticheat() {
  if (!anticheatArmed) return;
  anticheatArmed = false;
  testRunning    = false;
  choicesLocked  = true;

  clearActiveTimer();

  var score    = calculateScore();
  var fullName = candidateFirstName + ' ' + candidateLastName;

  /* Keep 'voided' in localStorage — this candidate remains blocked */
  localStorage.setItem('test_status', 'voided');

  var msg =
    'IQ Assessment Report - Geomar Gulf LLC'                    + '\n\n' +
    'Candidate Name: '  + fullName                              + '\n'   +
    'Phone Number: '    + candidatePhone                        + '\n'   +
    'Designation: '     + candidateDesignation                  + '\n'   +
    'Final Score: '     + score + ' out of 25'                  + '\n'   +
    'Status: Terminated by Anti-Cheat Infraction / Reload Attempt';

  sendTelegram(msg);
  showScreen('final');
}

/* ============================================================
   INITIALISATION — Entry Point
   ============================================================ */

document.addEventListener('DOMContentLoaded', function() {

  var storedStatus = localStorage.getItem('test_status');

  if (storedStatus === 'running') {
    /*
     * Candidate refreshed the page mid-assessment.
     * Mark as voided, fire Telegram alert, block re-entry.
     */
    var storedPhone = localStorage.getItem('candidate_phone') || 'Unknown';
    localStorage.setItem('test_status', 'voided');

    var alertMsg =
      'IQ Assessment - Security Alert'                                    + '\n\n' +
      'Phone: '  + storedPhone                                            + '\n'   +
      'Event: Page reload detected during active assessment session'      + '\n'   +
      'Status: Terminated by Anti-Cheat Infraction / Reload Attempt';

    sendTelegram(alertMsg);
    showScreen('blocked');
    return;
  }

  if (storedStatus === 'voided') {
    /* Anti-cheat violation in a previous session — block all re-entry */
    showScreen('blocked');
    return;
  }

  /* Clean state — begin normal flow from Step 1 */
  showScreen('legal');

  /* ── Submit Results to HR button → open success modal ── */
  var btnSubmitHR = document.getElementById('btn-submit-hr');
  if (btnSubmitHR) {
    btnSubmitHR.addEventListener('click', function() {
      var overlay = document.getElementById('modal-overlay');
      if (overlay) overlay.classList.remove('hidden');
    });
  }

  /* ── Success modal Close button → transition to final screen ── */
  var btnModalClose = document.getElementById('modal-close-btn');
  if (btnModalClose) {
    btnModalClose.addEventListener('click', function() {
      var overlay = document.getElementById('modal-overlay');
      if (overlay) overlay.classList.add('hidden');
      showScreen('final');
    });
  }

  /* ── Confirm modal: "Go Back" → close modal, stay on test ── */
  var btnConfirmCancel = document.getElementById('modal-confirm-cancel');
  if (btnConfirmCancel) {
    btnConfirmCancel.addEventListener('click', function() {
      var confirmModal = document.getElementById('modal-confirm');
      if (confirmModal) confirmModal.classList.add('hidden');
    });
  }

  /* ── Confirm modal: "Yes, Submit" → close modal, conclude assessment ── */
  var btnConfirmSubmit = document.getElementById('modal-confirm-submit');
  if (btnConfirmSubmit) {
    btnConfirmSubmit.addEventListener('click', function() {
      var confirmModal = document.getElementById('modal-confirm');
      if (confirmModal) confirmModal.classList.add('hidden');
      concludeAssessment('Completed Successfully', false);
    });
  }
});

/* ============================================================
   STEP 1 — LEGAL & PRIVACY CONSENT
   ============================================================ */

document.getElementById('btn-accept').addEventListener('click', function() {
  showScreen('profile');
});

/* ============================================================
   STEP 2 — CANDIDATE PROFILING
   ============================================================ */

document.getElementById('profile-form').addEventListener('submit', function(e) {
  e.preventDefault();

  var firstName   = document.getElementById('input-firstname').value.trim();
  var lastName    = document.getElementById('input-lastname').value.trim();
  var phone       = document.getElementById('input-phone').value.trim();
  var designation = document.getElementById('input-designation').value.trim();

  var valid = true;

  /* Validate First Name */
  if (!firstName) {
    document.getElementById('err-firstname').textContent = 'First name is required.';
    document.getElementById('input-firstname').classList.add('error');
    valid = false;
  } else {
    document.getElementById('err-firstname').textContent = '';
    document.getElementById('input-firstname').classList.remove('error');
  }

  /* Validate Last Name */
  if (!lastName) {
    document.getElementById('err-lastname').textContent = 'Last name is required.';
    document.getElementById('input-lastname').classList.add('error');
    valid = false;
  } else {
    document.getElementById('err-lastname').textContent = '';
    document.getElementById('input-lastname').classList.remove('error');
  }

  /* Validate Phone */
  if (!phone) {
    document.getElementById('err-phone').textContent = 'Phone number is required.';
    document.getElementById('input-phone').classList.add('error');
    valid = false;
  } else {
    document.getElementById('err-phone').textContent = '';
    document.getElementById('input-phone').classList.remove('error');
  }

  /* Validate Designation */
  if (!designation) {
    document.getElementById('err-designation').textContent = 'Designation is required.';
    document.getElementById('input-designation').classList.add('error');
    valid = false;
  } else {
    document.getElementById('err-designation').textContent = '';
    document.getElementById('input-designation').classList.remove('error');
  }

  if (!valid) return;

  candidateFirstName   = firstName;
  candidateLastName    = lastName;
  candidatePhone       = phone;
  candidateDesignation = designation;

  showScreen('camera');
});

/* ============================================================
   STEP 3 — CAMERA VERIFICATION
   ============================================================ */

document.getElementById('btn-init-camera').addEventListener('click', function() {
  var self = this;
  self.disabled    = true;
  self.textContent = 'Requesting access...';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    /* Browser does not support getUserMedia — allow continuation */
    self.classList.add('hidden');
    document.getElementById('btn-start-test').classList.remove('hidden');
    return;
  }

  navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then(function(stream) {
      var videoEl = document.getElementById('camera-video');
      videoEl.srcObject = stream;

      /* Mount floating live camera widget */
      document.getElementById('camera-float').classList.remove('hidden');

      /* Update camera screen UI */
      self.classList.add('hidden');
      document.getElementById('camera-status').classList.remove('hidden');
      document.getElementById('btn-start-test').classList.remove('hidden');
    })
    .catch(function() {
      /* Camera access denied — allow candidate to continue without camera */
      self.classList.add('hidden');
      document.getElementById('btn-start-test').classList.remove('hidden');
    });
});

document.getElementById('btn-start-test').addEventListener('click', function() {
  beginCountdown();
});

/* ============================================================
   STEP 4 — ANIMATED COUNTDOWN (5 -> 1)
   ============================================================ */

function beginCountdown() {
  /* Commit test_status to localStorage immediately */
  localStorage.setItem('test_status', 'running');
  localStorage.setItem('candidate_phone', candidatePhone);

  testRunning = true;

  showScreen('countdown');

  var count = 5;
  var numEl = document.getElementById('countdown-number');

  function animateIn(n) {
    /* Reset to scaled-up invisible state */
    numEl.style.transition = 'none';
    numEl.style.transform  = 'scale(1.45)';
    numEl.style.opacity    = '0';
    numEl.textContent      = n;

    /* Force layout reflow before applying transition */
    void numEl.offsetWidth;

    /* Animate into natural position */
    numEl.style.transition = 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.38s ease';
    numEl.style.transform  = 'scale(1)';
    numEl.style.opacity    = '1';
  }

  function animateOut(callback) {
    numEl.style.transition = 'transform 0.28s ease-in, opacity 0.28s ease-in';
    numEl.style.transform  = 'scale(0.45)';
    numEl.style.opacity    = '0';
    setTimeout(callback, 300);
  }

  animateIn(count);

  var tick = setInterval(function() {
    count--;

    if (count <= 0) {
      clearInterval(tick);
      animateOut(function() {
        anticheatArmed = true;
        launchTest();
      });
      return;
    }

    animateOut(function() {
      animateIn(count);
    });

  }, 1000);
}

/* ============================================================
   STEP 5 — CORE TEST ENGINE
   ============================================================ */

function launchTest() {
  currentQuestion = 0;
  answers         = [];
  choicesLocked   = false;
  totalTimeLeft   = 2700;   /* Reset to 45:00 */

  showScreen('test');

  /* Render initial timer display then start the global countdown */
  updateTimerDisplay();
  startGlobalTimer();

  loadQuestion(0);
}

/**
 * Load a question by zero-based index.
 * Updates the question image, counter, navigation controls,
 * and highlights any previously saved answer for this question.
 */
function loadQuestion(index) {
  /* Guard against out-of-range indices */
  if (index < 0) return;
  if (index >= QUESTIONS.length) return;

  /* Sync global currentQuestion tracker */
  currentQuestion = index;
  choicesLocked   = false;

  var q = QUESTIONS[index];

  /* Update question image */
  document.getElementById('question-image').src = q.image;

  /* Update counter label */
  document.getElementById('question-counter').textContent =
    'Question ' + (index + 1) + ' of ' + QUESTIONS.length;

  /* Render navigation buttons and highlight saved answer */
  renderNavigationControls(index);
}

/* ============================================================
   NAVIGATION CONTROLS RENDERER
   ============================================================ */

/**
 * Inject Back / Next / Finish Assessment buttons into #dynamic-nav-container.
 * Applies the .btn-nav class for full button styling.
 * Highlights the previously saved answer for this question index.
 * "Finish Assessment" opens the custom confirm modal instead of a native dialog.
 */
function renderNavigationControls(index) {
  var controlsFrame = document.getElementById('dynamic-nav-container');
  if (!controlsFrame) return;

  var isFirst = (index === 0);
  var isLast  = (index === QUESTIONS.length - 1);

  /* Build button HTML */
  var html =
    '<button class="btn-nav" id="btn-nav-back"' + (isFirst ? ' disabled' : '') + '>' +
    '&#8592; Back' +
    '</button>';

  if (isLast) {
    html += '<button class="btn-nav finish" id="btn-nav-finish">Finish Assessment</button>';
  } else {
    html += '<button class="btn-nav" id="btn-nav-next">Next &#8594;</button>';
  }

  controlsFrame.innerHTML = html;

  /* ── Highlight saved answer for this question (dark graphite) ── */
  document.querySelectorAll('.btn-choice').forEach(function(btn) {
    btn.classList.remove('selected');
    if (answers[index] && answers[index] === btn.getAttribute('data-choice')) {
      btn.classList.add('selected');
    }
  });

  /* ── Bind navigation click handlers ── */
  document.getElementById('btn-nav-back').onclick = function() {
    loadQuestion(index - 1);
  };

  if (isLast) {
    /* Open the custom styled confirm modal — no native confirm() dialog */
    document.getElementById('btn-nav-finish').onclick = function() {
      var confirmModal = document.getElementById('modal-confirm');
      if (confirmModal) confirmModal.classList.remove('hidden');
    };
  } else {
    document.getElementById('btn-nav-next').onclick = function() {
      loadQuestion(index + 1);
    };
  }
}

/* ============================================================
   CHOICE BUTTON HANDLER
   Clicking a choice records the answer and highlights the button.
   Does NOT auto-advance — the candidate uses the Next button to proceed.
   ============================================================ */

document.getElementById('choices-grid').addEventListener('click', function(e) {
  if (choicesLocked) return;

  var btn = e.target.closest('.btn-choice');
  if (!btn) return;

  var choice = btn.getAttribute('data-choice');

  /* Record answer for the current question */
  answers[currentQuestion] = choice;

  /* Update visual selection — remove from all, apply to clicked */
  document.querySelectorAll('.btn-choice').forEach(function(b) {
    b.classList.remove('selected');
  });
  btn.classList.add('selected');
});
