
document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const user = { name: document.getElementById('full-name').value.trim(), email: document.getElementById('email').value.trim(), password: document.getElementById('password').value, role: document.getElementById('role').value };
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Signing you in…';
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    localStorage.setItem('capacityConnectUser', JSON.stringify(result.user));
    localStorage.setItem('capacityConnectProgress', localStorage.getItem('capacityConnectProgress') || '65');
    if (result.user.role === 'Learner') {
  window.location.href = 'employee.html';
} else if (result.user.role === 'Trainer') {
  window.location.href = 'trainer.html';
} else if (result.user.role === 'Admin') {
  window.location.href = 'admin.html';
} else if (result.user.role === 'Management') {
  window.location.href = 'management.html';
} else {
  window.location.href = 'employee.html';
}
  } catch (error) {
    submitButton.disabled = false;
    submitButton.textContent = 'Register / Sign in →';
    alert(error.message || 'Could not sign in. Please try again.');
  }
});
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("toggle-password");

togglePassword.addEventListener("click", function () {
  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    togglePassword.textContent = "◉";
  } else {
    passwordInput.type = "password";
    togglePassword.textContent = "◉";
  }
});