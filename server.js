'use strict';

const path = require('path');
const express = require('express');
const { validateInput, LIMITS } = require('./src/validate');
const { solve } = require('./src/solver');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/limits', (_req, res) => {
  res.json(LIMITS);
});

app.post('/api/solve', (req, res) => {
  let input;
  try {
    input = validateInput(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const result = solve(input);
    res.json({ result, limits: LIMITS });
  } catch (err) {
    res.status(500).json({ error: '求解失败: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`对比度调色板求解器已启动: http://localhost:${PORT}`);
});
