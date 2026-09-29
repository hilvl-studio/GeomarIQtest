/* ============================================================
   GEOMAR GULF LLC — IQ ASSESSMENT PLATFORM
   questions.js — Engine Logic, Anti-Cheat & Telegram Integration
   ============================================================ */

'use strict';

/* ===== CONFIGURATION ===== */
const TELEGRAM_BOT_TOKEN = "8983686015:AAEjimFk4BkXzdFcBUDneYL4iBVFcB5q05k";
const TELEGRAM_CHAT_ID = "-1004394363945";

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

/* ===== RUNTIME STATE ===== */
let candidateFirstName = '';
let candidateLastName  = '';
let candidatePhone     = '';
let currentQuestion    = 0;
let answers            = [];
let timerInterval      = null;
let timeLeft           = 25;
let testRunning        = false;   // true from countdown start -> finish/terminate
let anticheatArmed     = false;   // true only during active question display
let telegramSent       = false;   // guard against duplicate transmissions
let choicesLocked      = false;   // prevents double-click race on choice buttons

/* ===== DOM REFERENCES ===== */
const SCREENS = {
  blocked:   document.getElementById('screen-blocked'),
  legal:     document.getElementById('screen-legal'),
  profile:   document.getElementById('screen-profile'),
  camera:    document.getElementById('screen-camera'),
  countdown: document.getElementById('screen-countdown'),
  test:      document.getElementById('screen-test'),
  timesup:   document.getElementById('screen-timesup'),
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
    el.classList.add('hidden');
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

/**
 * Build and dispatch the Telegram result payload, then show the final screen.
 * @param {string} status - termination status string
 */
function concludeAssessment(status) {
  testRunning    = false;
  anticheatArmed = false;
  choicesLocked  = true;

  clearActiveTimer();

  var score    = calculateScore();
  var fullName = candidateFirstName + ' ' + candidateLastName;

  localStorage.setItem('test_status', 'completed');

  var msg =
    'IQ Assessment Report - Geomar Gulf LLC' + '\n\n' +
    'Candidate Name: ' + fullName            + '\n'   +
    'Phone Number: '   + candidatePhone      + '\n'   +
    'Final Score: '    + score + ' out of 25' + '\n'  +
    'Status: '         + status;

  sendTelegram(msg);
  showScreen('final');
}

/**
 * Anti-cheat termination path — sets voided state and fires Telegram alert.
 */
function terminateByAnticheat() {
  if (!anticheatArmed) return;
  anticheatArmed = false;
  testRunning    = false;
  choicesLocked  = true;

  clearActiveTimer();

  var score    = calculateScore();
  var fullName = candidateFirstName + ' ' + candidateLastName;

  localStorage.setItem('test_status', 'voided');

  var msg =
    'IQ Assessment Report - Geomar Gulf LLC'                    + '\n\n' +
    'Candidate Name: ' + fullName                               + '\n'   +
    'Phone Number: '   + candidatePhone                         + '\n'   +
    'Final Score: '    + score + ' out of 25'                   + '\n'   +
    'Status: Terminated by Anti-Cheat Infraction / Reload Attempt';

  sendTelegram(msg);
  showScreen('final');
}

/* ============================================================
   TIMER ENGINE
   ============================================================ */

function clearActiveTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  var valEl    = document.getElementById('timer-value');
  var widgetEl = document.getElementById('timer-widget');

  valEl.textContent = timeLeft;

  /* Fluid color interpolation via CSS transition on background-color */
  widgetEl.classList.remove('state-yellow', 'state-red');
  if (timeLeft <= 5) {
    widgetEl.classList.add('state-red');
  } else if (timeLeft <= 15) {
    widgetEl.classList.add('state-yellow');
  }
}

function startQuestionTimer() {
  clearActiveTimer();
  timeLeft = 25;
  updateTimerDisplay();

  timerInterval = setInterval(function() {
    timeLeft--;
    updateTimerDisplay();

    if (timeLeft <= 0) {
      clearActiveTimer();
      handleTimeout();
    }
  }, 1000);
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

  if (storedStatus === 'voided' || storedStatus === 'completed') {
    /* Previous session exists — block all re-entry */
    showScreen('blocked');
    return;
  }

  /* Clean state — begin normal flow */
  showScreen('legal');
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

  var firstName = document.getElementById('input-firstname').value.trim();
  var lastName  = document.getElementById('input-lastname').value.trim();
  var phone     = document.getElementById('input-phone').value.trim();

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

  if (!valid) return;

  candidateFirstName = firstName;
  candidateLastName  = lastName;
  candidatePhone     = phone;

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

  showScreen('test');
  loadQuestion(0);
}

function loadQuestion(index) {
  if (index >= QUESTIONS.length) {
    concludeAssessment('Completed Successfully');
    return;
  }

  choicesLocked = false;

  var q = QUESTIONS[index];

  /* Update image */
  document.getElementById('question-image').src = q.image;

  /* Update counter */
  document.getElementById('question-counter').textContent =
    'Question ' + (index + 1) + ' of 25';

  /* Reset timer widget to green */
  var widgetEl = document.getElementById('timer-widget');
  widgetEl.classList.remove('state-yellow', 'state-red');

  /* Start 25-second countdown */
  startQuestionTimer();
}

function handleTimeout() {
  /* Record empty answer for this question */
  answers[currentQuestion] = '';
  choicesLocked = true;

  /* Show TIME IS UP overlay for exactly 3 seconds */
  showScreen('timesup');

  setTimeout(function() {
    currentQuestion++;

    if (currentQuestion >= QUESTIONS.length) {
      concludeAssessment('Completed Successfully');
    } else {
      showScreen('test');
      loadQuestion(currentQuestion);
    }
  }, 3000);
}

/* ===== CHOICE BUTTON HANDLER ===== */
document.getElementById('choices-grid').addEventListener('click', function(e) {
  if (choicesLocked) return;

  var btn = e.target.closest('.btn-choice');
  if (!btn) return;

  /* Lock immediately to prevent double-click race */
  choicesLocked = true;
  clearActiveTimer();

  var choice = btn.getAttribute('data-choice');
  answers[currentQuestion] = choice;

  currentQuestion++;

  if (currentQuestion >= QUESTIONS.length) {
    concludeAssessment('Completed Successfully');
  } else {
    loadQuestion(currentQuestion);
  }
});
