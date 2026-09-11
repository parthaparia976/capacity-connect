const capacityUser = JSON.parse(localStorage.getItem('capacityConnectUser') || 'null');
if (!capacityUser) window.location.replace('login.html');
