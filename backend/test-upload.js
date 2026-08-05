const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testUpload() {
  try {
    const form = new FormData();
    form.append('files', fs.createReadStream(path.join(__dirname, '../sample_rubric.txt')));

    const response = await axios.post('http://localhost:5000/api/guides/upload', form, {
      headers: {
        ...form.getHeaders()
      }
    });
    console.log('Upload Success:', response.data);
  } catch (error) {
    console.error('Upload Error:', error.response?.data || error.message);
  }
}

testUpload();
