'use strict'

var inherits = require('inherits')
var request = require('request')
var BaseChannelAuth = require('./base-channel-auth')
var PermanentAuthenticationError = require('./permanent-authentication-error')
var TemporaryAuthenticationError = require('./temporary-authentication-error')
var util = require('./util')

var LOGIN_PATH_FRAGMENT = '/identity/v1/login'

/**
 * @classdesc Authentication class for use with channel requests.
 * @param {String} base - Base URL to forward authentication requests to.
 * @param {String} username - User name to supply for request authentication.
 * @param {String} password - Password to supply for request authentication.
 * @param {Object} [options] - Additional options to supply for request
 *   authentication.
 * @param {String} [options.key] - Optional client private keys in PEM format.
 *   See
 *   {@link https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options}.
 * @param {String} [options.cert] - Optional client cert chains in PEM format.
 *   See
 *   {@link https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options}.
 * @param {String} [options.ca] - Optionally override the trusted CA
 *   certificates used to validate the authentication server. Any string can
 *   contain multiple PEM CAs concatenated together.
 *   See
 *   {@link https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options}.
 * @param {String} [options.passphrase] - Optional shared passphrase used for a
 *   single private key. See
 *   {@link https://nodejs.org/api/tls.html#tls_tls_createsecurecontext_options}.
 * @param {Boolean} [options.rejectUnauthorized=true] - If not false, the server
 *   certificate is verified against the list of supplied CAs. See
 *   {@link https://nodejs.org/api/tls.html#tls_tls_connect_options_callback}.
 * @param {Function} [options.checkServerIdentity] - A callback function to
 *   be used when checking the server's hostname against the certificate.
 *   See
 *   {@link https://nodejs.org/api/tls.html#tls_tls_connect_options_callback}.
 * @implements {BaseChannelAuth}
 * @constructor
 */
function ChannelAuth (base, username, password, options) {
  BaseChannelAuth.call(this)
  this._loginRequest = request.defaults(
    util.addTlsOptions({
      baseUrl: base,
      uri: LOGIN_PATH_FRAGMENT
    }, options)
  )

  this._username = username
  this._password = password
  this._token = null

  /**
   * Append the current token to the `bearer` property in the supplied
   * `requestOptions` object.
   * @param {Object} requestOptions - The request options.
   * @param {BaseChannelAuth~authCallback} callback - A callback to invoke
   *   with the modified `requestOptions`.
   * @private
   */
  this._addBearerAuthToken = function (requestOptions, callback) {
    requestOptions.auth = {bearer: this._token}
    callback(null, requestOptions)
  }
}

inherits(ChannelAuth, BaseChannelAuth)

/**
 * Authenticate the user for an HTTP channel request. The supplied callback
 * should be invoked with the results of the authentication attempt. See
 * {@link BaseChannelAuth~authCallback} for more information on the
 * content provided to the callback.
 * @param {Object} requestOptions - Options included in the HTTP channel
 *   request.
 * @param {BaseChannelAuth~authCallback} callback - Callback function
 *   invoked with the results of the authentication attempt.
 */
ChannelAuth.prototype.authenticate = function (requestOptions, callback) {
  var that = this
  if (this._token) {
    // Token was acquired previously, so use it for the request
    this._addBearerAuthToken(requestOptions, callback)
  } else {
    // Token was not acquired previously, so make a login request to get
    // a token.
    this._loginRequest.get(
      {
        auth: {
          user: this._username,
          password: this._password
        },
        json: true
      },
      function (error, response, body) {
        if (error) {
          callback(new TemporaryAuthenticationError(
            'Unexpected error: ' + error.message
          ))
        } else if (response.statusCode === 200) {
          if (body.AuthorizationToken) {
            // Token was acquired successfully, so set it into the options
            // for the original request and invoke the request callback to
            // continue.
            that._token = body.AuthorizationToken
            that._addBearerAuthToken(requestOptions, callback)
          } else {
            callback(new PermanentAuthenticationError(
              'Unable to locate AuthorizationToken in login response'
            ))
          }
        } else if ([401, 403].indexOf(response.statusCode) >= 0) {
          callback(new PermanentAuthenticationError(
            'Unauthorized ' + response.statusCode + ': ' + body
          ))
        } else {
          callback(new TemporaryAuthenticationError(
            'Unexpected status code ' + response.statusCode + ': ' +
            JSON.stringify(body)
          ))
        }
      }
    )
  }
}

/**
 * Purge any credentials cached from a previous authentication.
 */
ChannelAuth.prototype.reset = function () {
  this._token = null
}

module.exports = ChannelAuth
