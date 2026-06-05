import axios from 'axios';
const testEndpoint = async () => {
    try {
        const response = await axios.get("http://127.0.0.1:3000/api/minifigures/71047");
        console.log("SUCCESS:", JSON.stringify(response.data, null, 2));
    } catch (e) {
        console.error("ERROR:", e);
    }
}
testEndpoint();
