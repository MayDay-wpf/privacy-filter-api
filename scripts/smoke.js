import assert from 'node:assert/strict';

const baseUrl = process.env.API_URL || 'http://127.0.0.1:3000';
const text = 'My name is Harry Potter and my email is harry.potter@hogwarts.edu.';

const response = await fetch(`${baseUrl}/detect`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text }),
});

assert.equal(response.ok, true, await response.text());

const payload = await response.json();
assert.equal(Array.isArray(payload.entities), true);

console.dir(payload, { depth: null });
