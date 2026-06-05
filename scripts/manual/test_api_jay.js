import axios from 'axios';
axios.get('http://localhost:3000/api/lego/71822')
.then(res => console.log('Success:', res.data))
.catch(err => console.log('Error:', err.response?.data || err.message));
