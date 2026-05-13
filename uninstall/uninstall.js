const FEEDBACK_ENDPOINT = 'https://api.thecanadalist.ca/v1/extension/uninstall-feedback';

const form = document.getElementById('uninstall-feedback-form');
const otherCheckbox = document.getElementById('reason-other');
const otherText = document.getElementById('other-text');
const statusText = document.getElementById('feedback-status');

otherCheckbox.addEventListener('change', () => {
  otherText.disabled = !otherCheckbox.checked;
  if (!otherCheckbox.checked) {
    otherText.value = '';
  } else {
    otherText.focus();
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const submitButton = form.querySelector('button[type="submit"]');
  const reasons = [...form.querySelectorAll('input[name="reason"]:checked')]
    .map(input => input.value);

  if (reasons.length === 0 && !form.explanation.value.trim()) {
    statusText.textContent = 'Please choose a reason or leave a short note.';
    return;
  }

  const payload = {
    reasons,
    otherReason: form.otherReason.value.trim(),
    explanation: form.explanation.value.trim(),
    source: 'chrome_extension_uninstall',
    submittedAt: new Date().toISOString(),
  };

  submitButton.disabled = true;
  statusText.textContent = 'Sending feedback...';

  try {
    const response = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw new Error(`Feedback endpoint returned ${response.status}`);

    form.reset();
    otherText.disabled = true;
    statusText.textContent = 'Thank you. Your feedback helps us improve The Canada List.';
  } catch {
    statusText.textContent = 'We could not submit feedback right now. Please try again later.';
  } finally {
    submitButton.disabled = false;
  }
});
