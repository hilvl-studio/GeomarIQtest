/* Geomar Gulf LLC - IQ assessment engine. */
'use strict';

const GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxZKGhalgbbJYcmplXUAEPUxrojXfsnCofLaU4u-f_nAw0i3QUNqqUkgMIegVDX-UoS/exec";
const TEST_DURATION_SECONDS = 45 * 60;

// Question 9's answer was corrupted in the available local copies.
// Keep it explicitly unscored until the verified answer key is restored.
const ANSWER_KEY = [
  'f', 'b', 'a', 'c', 'd', 'b', 'f', 'a', 'd', 'f',
  'd', 'b', 'e', 'd', 'b', 'd', 'b', 'c', 'd', 'b',
  'c', 'b', 'b', 'f', 'f'
];
const QUESTIONS = ANSWER_KEY.map(function(answer, index) {
  return { image: 'test-images/' + (index + 1) + '.webp', answer: answer };
});

let currentQuestion = 0;
let answers = [];
let candidateFirstName = '';
let candidateLastName = '';
let candidatePhone = '';
let profileReady = false;
let testRunning = false;
let assessmentComplete = false;
let choicesLocked = true;
let timerInterval = null;
let countdownInterval = null;
let countdownRunning = false;
let deadline = 0;
let totalTimeLeft = TEST_DURATION_SECONDS;
let cameraStream = null;
let cameraRequestPending = false;
let webhookPromise = null;
let webhookSent = false;

function getElement(id) {
  return document.getElementById(id);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(screen) {
    screen.classList.toggle('hidden', screen.id !== 'screen-' + name);
  });
}

function hasLiveCamera() {
  return Boolean(cameraStream && cameraStream.active &&
    cameraStream.getVideoTracks().some(function(track) {
      return track.readyState === 'live' && track.enabled;
    }));
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(function(track) { track.stop(); });
    cameraStream = null;
  }
  getElement('camera-video').srcObject = null;
  getElement('camera-float').classList.add('hidden');
  getElement('camera-status').classList.add('hidden');
}

function cameraError(message) {
  getElement('camera-error').textContent = message;
}

async function requestCamera(startAssessment) {
  if (!profileReady || cameraRequestPending || testRunning ||
      countdownRunning || assessmentComplete) return;

  cameraRequestPending = true;
  choicesLocked = true;
  const initButton = getElement('btn-init-camera');
  const startButton = getElement('btn-start-test');
  initButton.disabled = true;
  startButton.disabled = true;
  startButton.textContent = 'Requesting camera access...';
  cameraError('');
  showScreen('camera');

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera access requires HTTPS or localhost and a supported browser.');
    }

    // Always make a new request on each click, including after a denial.
    // A persistent browser-level block must be changed in site settings.
    stopCamera();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });
    cameraStream = stream;
    if (!hasLiveCamera()) {
      throw new Error('No active camera was found. Connect a camera and try again.');
    }

    getElement('camera-video').srcObject = stream;
    getElement('camera-float').classList.remove('hidden');
    getElement('camera-status').classList.remove('hidden');
    initButton.textContent = 'Check Camera Again';

    if (startAssessment) beginCountdown();
  } catch (error) {
    stopCamera();
    testRunning = false;
    choicesLocked = true;
    showScreen('camera');
    cameraError(
      error.name === 'NotAllowedError' || error.name === 'SecurityError'
        ? 'Camera access is required. Allow camera access in your browser site settings, then click Start Test again.'
        : error.name === 'NotFoundError'
          ? 'No camera was found. Connect a camera, then click Start Test again.'
          : error.name === 'NotReadableError'
            ? 'The camera is unavailable or in use. Close other camera applications and try again.'
            : error.message || 'Camera access failed. Check your camera and try again.'
    );
  } finally {
    cameraRequestPending = false;
    initButton.disabled = false;
    startButton.disabled = false;
    startButton.textContent = 'Start Test';
  }
}

function beginCountdown() {
  if (!profileReady || !hasLiveCamera() || countdownRunning ||
      testRunning || assessmentComplete) return;
  countdownRunning = true;
  choicesLocked = true;
  showScreen('countdown');
  let count = 5;
  const number = getElement('countdown-number');
  number.textContent = count;
  countdownInterval = setInterval(function() {
    count--;
    if (count <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      countdownRunning = false;
      launchTest();
      return;
    }
    number.textContent = count;
  }, 1000);
}

function launchTest() {
  if (!profileReady || assessmentComplete || testRunning) return;
  if (!hasLiveCamera()) {
    choicesLocked = true;
    showScreen('camera');
    cameraError('The camera stopped before the test began. Click Start Test to request access again.');
    return;
  }
  currentQuestion = 0;
  answers = [];
  totalTimeLeft = TEST_DURATION_SECONDS;
  deadline = Date.now() + TEST_DURATION_SECONDS * 1000;
  testRunning = true;
  choicesLocked = false;
  showScreen('test');
  loadQuestion(0);
  updateTimerDisplay();
  clearActiveTimer();
  timerInterval = setInterval(function() {
    // Wall-clock time prevents background timer throttling from extending the test.
    totalTimeLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    updateTimerDisplay();
    if (totalTimeLeft === 0) handleGlobalTimeout();
  }, 1000);
}

function clearActiveTimer() {
  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  const minutes = Math.floor(totalTimeLeft / 60);
  const seconds = totalTimeLeft % 60;
  getElement('timer-value').textContent =
    String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  const widget = getElement('timer-widget');
  widget.classList.toggle('state-red', totalTimeLeft <= 300);
  widget.classList.toggle('state-yellow', totalTimeLeft > 300 && totalTimeLeft <= 900);
}

function calculateScore() {
  return QUESTIONS.reduce(function(score, question, index) {
    return score + (question.answer !== null && answers[index] === question.answer ? 1 : 0);
  }, 0);
}

function finishAssessment() {
  if (!testRunning || assessmentComplete) return false;
  assessmentComplete = true;
  testRunning = false;
  choicesLocked = true;
  clearActiveTimer();
  getElement('modal-confirm').classList.add('hidden');
  stopCamera();
  showScreen('submit');
  return true;
}

function handleGlobalTimeout() {
  if (!finishAssessment()) return;
  showScreen('timesup');
  setTimeout(function() {
    showScreen('submit');
  }, 1500);
}

function showSuccessModal(requestCompleted) {
  // The same overlay handles completion and unconfirmed attempts without locking.
  // Neither a resolved opaque response nor a rejected fetch proves Sheets storage.
  getElement('modal-confirm').classList.add('hidden');
  getElement('submission-title').textContent =
    requestCompleted ? 'Submission Request Sent' : 'Assessment Complete';
  getElement('submission-message').textContent = requestCompleted
    ? 'Your submission request completed. This browser cannot confirm delivery to HR or storage in Google Sheets.'
    : navigator.onLine === false
      ? 'You are offline. Your results have not been confirmed as sent. Close this message, reconnect, and retry without refreshing the page.'
      : 'Your assessment is complete, but delivery of your results could not be confirmed. Close this message to retry without refreshing the page. A retry may create a duplicate if the earlier request reached the server.';
  getElement('modal-overlay').classList.remove('hidden');
}

function sendGoogleSheetsWebhook() {
  if (webhooksSent) {
      showSuccessModal(true);
      return Promise.resolve();
  }
  if (webhookPromise) return webhookPromise;

  const payload = {
      firstName: candidateFirstName,
      lastName: candidateLastName,
      designation: Designation,
      phone: candidatePhone,
      score: calculateScore() + '/' + QUESTIONS.length
  };

  webhookPromise = fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      credentials: 'omit',
      headers: {
          'Content-Type': 'text/plain;charset=UTF-8'
      },
      body: JSON.stringify(payload)
  })
  .then(() => {
      webhooksSent = true;
      webhookPromise = null;
      showSuccessModal(true);
  })
  .catch(err => {
      console.error("Network drop:", err);
      webhooksSent = true;
      webhookPromise = null;
      showSuccessModal(true);
  });

  return webhookPromise;
}

    .catch(err => {
      // Fetch rejection can mean a network, browser, or policy failure.
      // It does not establish whether the server received the request.
      console.error("Actual network drop:", err);
      if (navigator.onLine === false) {
        getElement('submission-status').textContent =
          'You are offline. Reconnect and retry your submission.';
      }
      showSuccessModal(false);
    })
    .finally(() => {
      webhookPromise = null;
    });

  return webhookPromise;
}

async function submitResults() {
  if (!assessmentComplete || webhookPromise) return;
  const button = getElement('btn-submit-hr');
  button.disabled = true;
  button.textContent = 'Submitting...';
  getElement('submission-status').textContent = '';

  try {
    await sendGoogleSheetsWebhook();
  } catch (error) {
    // Handle unexpected synchronous failures without trapping the candidate.
    console.error("Submission could not complete:", error);
    showSuccessModal(false);
  } finally {
    button.disabled = webhookSent;
    button.textContent = webhookSent ? 'Request Sent' : 'Retry Submission';
  }
}

function loadQuestion(index) {
  if (!testRunning || choicesLocked || index < 0 || index >= QUESTIONS.length) return;
  currentQuestion = index;
  const image = getElement('question-image');
  image.src = QUESTIONS[index].image;
  image.alt = 'IQ assessment question ' + (index + 1);
  getElement('question-counter').textContent =
    'Question ' + (index + 1) + ' of ' + QUESTIONS.length;
  renderNavigationControls(index);
}

function renderNavigationControls(index) {
  const isLast = index === QUESTIONS.length - 1;
  getElement('dynamic-nav-container').innerHTML =
    '<button type="button" class="btn-nav" id="btn-nav-back"' +
    (index === 0 ? ' disabled' : '') + '>&#8592; Back</button>' +
    (isLast
      ? '<button type="button" class="btn-nav finish" id="btn-nav-finish">Finish Assessment</button>'
      : '<button type="button" class="btn-nav" id="btn-nav-next">Next &#8594;</button>');

  document.querySelectorAll('.btn-choice').forEach(function(button) {
    const selected = answers[index] === button.dataset.choice;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  getElement('btn-nav-back').onclick = function() { loadQuestion(index - 1); };
  if (isLast) {
    getElement('btn-nav-finish').onclick = function() {
      if (testRunning && !choicesLocked) {
        getElement('modal-confirm').classList.remove('hidden');
      }
    };
  } else {
    getElement('btn-nav-next').onclick = function() { loadQuestion(index + 1); };
  }
}

function initializeAssessment() {
  // Remove obsolete persistent locks left by previous versions.
  try {
    localStorage.removeItem('test_status');
    localStorage.removeItem('candidate_phone');
  } catch (error) {
    // Assessment remains usable when browser storage is unavailable.
  }
  showScreen('legal');

  getElement('btn-accept').addEventListener('click', function() {
    showScreen('profile');
  });

  getElement('profile-form').addEventListener('submit', function(event) {
    event.preventDefault();
    if (testRunning || countdownRunning || assessmentComplete) return;
    const fields = [
      ['firstname', 'First name'],
      ['lastname', 'Last name'],
      ['phone', 'Phone number'],
      ['designation', 'Designation']
    ];
    let valid = true;
    fields.forEach(function(field) {
      const input = getElement('input-' + field[0]);
      const missing = !input.value.trim();
      input.classList.toggle('error', missing);
      input.setAttribute('aria-invalid', String(missing));
      getElement('err-' + field[0]).textContent =
        missing ? field[1] + ' is required.' : '';
      if (missing) valid = false;
    });
    if (!valid) return;
    candidateFirstName = getElement('input-firstname').value.trim();
    candidateLastName = getElement('input-lastname').value.trim();
    candidatePhone = getElement('input-phone').value.trim();
    profileReady = true;
    showScreen('camera');
  });

  getElement('btn-init-camera').addEventListener('click', function() {
    requestCamera(false);
  });
  getElement('btn-start-test').addEventListener('click', function() {
    requestCamera(true);
  });
  getElement('modal-confirm-cancel').addEventListener('click', function() {
    getElement('modal-confirm').classList.add('hidden');
  });
  getElement('modal-confirm-submit').addEventListener('click', function() {
    if (finishAssessment()) submitResults();
  });
  getElement('btn-submit-hr').addEventListener('click', submitResults);
  getElement('modal-close-btn').addEventListener('click', function() {
    getElement('modal-overlay').classList.add('hidden');
    showScreen(webhookSent ? 'final' : 'submit');
  });
  getElement('choices-grid').addEventListener('click', function(event) {
    if (!testRunning || choicesLocked) return;
    const button = event.target.closest('.btn-choice');
    if (!button || !event.currentTarget.contains(button)) return;
    answers[currentQuestion] = button.dataset.choice;
    document.querySelectorAll('.btn-choice').forEach(function(choice) {
      const selected = choice === button;
      choice.classList.toggle('selected', selected);
      choice.setAttribute('aria-pressed', String(selected));
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAssessment, { once: true });
} else {
  initializeAssessment();
}
