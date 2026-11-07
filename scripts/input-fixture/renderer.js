document.getElementById('note').addEventListener('input', (event) => window.fixture.input(event.target.value));
document.getElementById('verify').addEventListener('click', () => { window.fixture.click(); document.getElementById('result').textContent = 'Click and typing verified!'; });
