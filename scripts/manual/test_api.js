import axios from 'axios';
axios.get('http://localhost:3000/api/lego/42115')
.then(res => console.log('Success:', res.data))
.catch(err => console.log('Error:', err.message));
