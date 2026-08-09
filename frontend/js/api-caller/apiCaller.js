/**
 * Makes a POST request to /api/{path} with a 
 * JSON payload and Authorization header
 * @param {string} path 
 * @param {Object} payload 
 * @returns {Promise<Object>}
 */
async function apiCall(path, payload) {
  /** @type RequestInit["headers"] */
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + localStorage.getItem('accessToken') || ''
  };

  const response = await fetch(
    'api/' + path,
    {
      headers,
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

  const json = await response.json();

  if (json.error) {
    console.warn('error', json.error);
    return json;
  }

  if (!json.data) {
    console.warn('No data property found in server response');
  }

  return json.data;
}


async function testLogin() {
  const response = await apiCall('login', { name: 'APP' })
  console.log(' - ping /login:', response);
  localStorage.setItem('accessToken', response.accessToken)
  localStorage.setItem('userName', response.userName)
  localStorage.setItem('userId', response.userId)
}

async function testWhoami() {
  const response = await apiCall('whoami', { testPayload: 123 });
  console.log(' - ping /whoami:', response);
}


export { apiCall, testWhoami, testLogin };
