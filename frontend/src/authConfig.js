// Replace these two values with yours from the Azure Portal.
export const TENANT_ID = import.meta.env.VITE_TENANT_ID;
export const CLIENT_ID = import.meta.env.VITE_CLIENT_ID;

export const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: import.meta.env.VITE_REDIRECT_URI || window.location.origin,
  },
  cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false },
};

export const loginRequest = {
  scopes: [`api://${CLIENT_ID}/access_as_user`],
};