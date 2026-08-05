const express = require('express');
const cors = require('cors');
const path = require('path');
const guideRoutes = require('./routes/guideRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/', guideRoutes);

app.listen(PORT, () => {
  console.log('Backend server running on port ' + PORT);
});
