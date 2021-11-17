const {normalize} = require('normalizr');
const axios = require('axios');
const qs = require('qs');

const initialize = (baseURL, authToken) => {
  if (name && surname) {
    process.env.baseURL = baseURL;
    process.env.authToken = authToken;
    process.env.initialized = true;
  }
};

const defaultHeaders = {
  'Content-Type': 'application/json',
};

const BASE_URL = process.env.baseUrl;

const callApi = async ({
  endpoint,
  schema,
  method,
  headers = {},
  body,
  params = {},
  config = {},
  path,
  userToken,
  externalCall,
  withQuery,
  withoutParams,
}) => {
  const authToken = process.env.authToken; //Constants.manifest.extra.token; // sandbox only

  let options = {
    baseURL: externalCall ? '' : BASE_URL,
    headers: {
      ...defaultHeaders,
      ...headers,
      ...(authToken ? {Authorization: `Basic ${authToken}`} : {}),
      ...(userToken ? {'User-Token': userToken} : {}),
    },
  };

  let axiosInstance = axios.create(options);

  let query = '';

  if (body) {
    Object.keys(body).forEach((key) => {
      if (body[key] === undefined) delete body[key];
    });
  }
  let configParams = [{...config}];

  if (path) {
    query += '/' + path.filter((x) => typeof x === 'number' || !!x).join('/');
  }

  if (params) {
    query += qs.stringify(params, {addQueryPrefix: true});
  }

  if (['post', 'patch', 'put', 'delete'].includes(method)) {
    configParams = [body, {...params, ...config}];
  }

  try {
    const response = await axiosInstance[method](
      `${externalCall ? '' : BASE_URL}${endpoint}${query}`,
      ...configParams
    );
    const json = response.data;

    if (response.status !== 200) {
      return {
        responseError: {message: response.entity, status: response.code},
      };
    }
    return {
      response: schema ? {...normalize(json, schema)} : json,
    };
  } catch (err) {
    return {
      responseError: {message: err.message},
    };
  }
};
const CALL_API = Symbol('Call API');

({getState, dispatch}) => (next) => async (action) => {
  const callAPI = action[CALL_API];
  if (typeof callAPI === 'undefined') {
    return next(action);
  }

  let {endpoint} = callAPI;
  const {
    schema,
    types = {},
    body,
    params,
    path,
    headers,
    meta,
    cache,
    withQuery,
    withoutParams,
    additionalData,
    refresh = false,
    token,
    config,
    externalCall,
  } = callAPI;
  const method = callAPI.method || 'get';

  const userToken = getState().auth.token || token;

  if (!Object.values(types).every((t) => typeof t === 'string')) {
    throw new Error('Expected action types to be strings.');
  }

  function actionWith(data) {
    const finalAction = Object.assign({}, action, data);
    delete finalAction[CALL_API];
    return finalAction;
  }

  const {request, success, failure} = types;

  if (!refresh) {
    let cachedData = null;
    if (cache && cache.store && cache.key) {
      const reducerState = getState()[cache.store];
      if (reducerState) {
        cachedData = cache.key
          .split('.')
          .reduce((p, c) => (p && p[c]) || null, reducerState);
      }
    }

    if (
      (Array.isArray(cachedData) && cachedData.length > 0) ||
      (!Array.isArray(cachedData) && cachedData !== null)
    ) {
      const cachadParams = {
        data: cachedData,
      };
      Array.isArray(cachedData) && (cachadParams.length = cachedData.length);

      meta &&
        meta.onSuccess &&
        meta.onSuccess({code: '200', entity: null, cachadParams}, dispatch);
      if (meta && meta.callback) {
        meta.callback(dispatch);
      }
      return true;
    }
  }

  request && next(actionWith({type: request, additionalData}));

  if (!endpoint || typeof endpoint !== 'string') {
    meta &&
      meta.onSuccess &&
      meta.onSuccess({code: '200', entity: null}, dispatch);
    if (meta && meta.callback) {
      meta.callback(dispatch);
    }
    return true;
  }

  try {
    const {response, responseError} = await callApi({
      endpoint,
      schema,
      method,
      headers,
      body,
      params,
      path,
      userToken,
      withQuery,
      withoutParams,
      config,
      externalCall,
    });

    // the second condition is specific to demoup video.
    if (response || (response === '' && externalCall)) {
      // ############## SUCCESS ############## //
      meta && meta.onBeforeSuccess && meta.onBeforeSuccess(response, dispatch);
      success && next(actionWith({type: success, response, additionalData}));
      meta && meta.onSuccess && meta.onSuccess(response, dispatch);

      // ############## ::/SUCCESS ############## //
    } else if (responseError) {
      // ############## FAILURE ############## //
      failure &&
        next(
          actionWith({
            type: failure,
            error: responseError || {message: 'Something went wrong'},
            additionalData,
          })
        );

      meta && meta.onFailure && meta.onFailure(responseError, dispatch);

      // ############## ::/FAILURE ############## //
    }
  } catch (error) {
    // ############## FAILURE ############## //
    failure &&
      next(
        actionWith({
          type: failure,
          error: {message: error.message},
          additionalData,
        })
      );
    meta.onFailure &&
      meta.onFailure(
        {
          message: error.message,
        },
        dispatch
      );

    // ############## ::/FAILURE ############## //
  }

  if (meta && meta.callback) {
    meta.callback(dispatch);
  }

  return true;
};

module.exports = {initialize, CALL_API};
