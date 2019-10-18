var packageInfo = require('./package.json');
var express = require('express');
var app = express();
var cookieParser = require('cookie-parser');
var passwords = require('./passwords.json');
var uuidv4 = require('uuid/v4');
var MongoClient = require('mongodb').MongoClient;
var graphqlHTTP = require('express-graphql');
var { buildSchema } = require('graphql');
var request = require('request').defaults({jar: true});
var serverCookie = request.jar();
const discordAPIUrl = 'http://discord.flowgaming.org';
serverCookie.setCookie('id=' + passwords.serverIdToken, discordAPIUrl);

app.set('view engine', 'pug');
app.use(cookieParser());

//Docker Port 4690 - 4699
var server = undefined;
var dbo = undefined;
MongoClient.connect("mongodb://localhost:27017/", function(err, db) {
  if (err) throw err;
  dbo = db.db("flow_gaming");

  server = app.listen(4690, function () {
    console.log("API 2.0 Server listening on port "+ server.address().port);
  })
});

var schema = buildSchema(`
  enum Ranks {
    Guest
    Regular
    Veteran
    Moderator
    Developer
    Admin
    Owner
  }

  enum AccountStatus {
    Unverified
    Verified
    Banned
  }

  type Game {
    name: [String]
  }

  type Access {
    games: [Game]
  }

  type User {
    rank: String
    username: String
    uniqueid: String
    email: String
    discordName: String
    discordId: String
    accountStatus: String
    ipList: [String]
    pc_hwid: String
    access: Access
  }

  enum SearchType {
    uniqueid
    discordId
    username
    email
  }

  enum FieldType {
    rank
    username
    uniqueid
    email
    discordId
    discordName
    accountStatus
    ipList
    pc_hwid
    access
  }

  type Query {
    getMe(uniqueid: String): User

    getUser(search: SearchType!, id: String!): User

    getAllUsers(serverToken: String): [User]
  }

  type Mutation {
    editUser(uniqueid: String!, field: FieldType!, data: String!): Boolean

    createUser(username: String!, email: String!, discordId: String!, discordName: String!, ip: String!): Boolean
  }
`);

var root = {
  getMe: function (params, context) {
    if (params.uniqueid != null) {
      return getMe(params.uniqueid);
    } else {
      return getMe(context.req.cookies.id);
    }
  },

  getUser: function (params, context) {
    if (params.id == "0")
      return;

    return getUser({type: params.search, identifier: params.id}, context);
  },

  getAllUsers: function (token, context) {
    if (token.length != null) return getAllUsers(sanitizeString(token), context)
    else return getAllUsers(sanitizeString(context.req.cookies.id), context)
  },

  editUser: function (params, context) {
    return editUser(params, context);
  },

  createUser: function (params, context) {
    return createUser({username: params.username, email: params.email, discordId: params.discordId, discordName: params.discordName, ip: params.ip}, context);
  }
};

app.use('/graphql', graphqlHTTP(function(req, res, params) {
  return {
    schema: schema,
    rootValue: root,
    graphiql: true,
    customFormatErrorFn: error => ({
      message: error.message
    }),
    context: { req, res, params }
  }
}));

app.get('/', (req, res) => {
  res.send(packageInfo.description + " on build " + packageInfo.version);
});

//=========================== Functions =============================

function getMe(token) {
  return new Promise((resolve, reject) => {
    if (token == null) {
      reportError(reject, ErrorStrings.INVALID_ID);
    } else {
      var cookie = sanitizeString(token);
      console.log("getMe() from "+ cookie);
      var cUsers = dbo.collection("users");

      cUsers.findOne({uniqueid: cookie}, function(err, me) {
        if (err) reportError(reject, err);
        resolve(me);
      });
    }
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function getUser (search, context) {
  return new Promise((resolve, reject) => {
    if (context.req == null) {
      reportError(reject, "Request is Null");
    } else if (context.req.cookies.id == null) {
      console.log(context.req);
      reportError(reject, ErrorStrings.INVALID_ID);
    } else {
      console.log('getUser(' + search.type + ', ' + search.identifier + ') from ' + context.req.cookies.id);
      var cUsers = dbo.collection("users");


      switch (search.type) {
        case SearchTypes.uniqueid:
          cUsers.findOne({uniqueid: search.identifier}, function(err, user) {
            if (err) reject(err);
            if (user == null) {
              return reportError(reject, ErrorStrings.INVALID_SEARCH);
            } else {
              isAuthOrAdmin(reject, context.req.cookies.id, user.uniqueid).then(() => {
                resolve(user);
              });
            }
          });
          break;
        case SearchTypes.discordId:
          cUsers.findOne({discordId: search.identifier}, function(err, user) {
            if (err) reject(err);
            if (user == null) {
              return reportError(reject, ErrorStrings.INVALID_SEARCH);
            } else {
              isAuthOrAdmin(reject, context.req.cookies.id, user.uniqueid).then((isAuthed) => {
                console.log(isAuthed);
                resolve(user);
              });
            }
          });
          break;
        case SearchTypes.username:
          cUsers.findOne({username: search.identifier}, function(err, user) {
            if (err) reject(err);
            if (user == null) {
              return reportError(reject, ErrorStrings.INVALID_SEARCH);
            } else {
              isAuthOrAdmin(reject, context.req.cookies.id, user.uniqueid).then(() => {
                resolve(user);
              });
            }
          });
          break;
        case SearchTypes.email:
          cUsers.findOne({email: search.identifier}, function(err, user) {
            if (err) reject(err);
            if (user == null) {
              return reportError(reject, ErrorStrings.INVALID_SEARCH);
            } else {
              isAuthOrAdmin(reject, context.req.cookies.id, user.uniqueid).then(() => {
                resolve(user);
              });
            }
          });
          break;
        default:
          reportError(reject, ErrorStrings.INVALID_SEARCH);
      }
    }
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function getAllUsers(token, context) {
  return new Promise((resolve, reject) => {
    console.log(token);
    isAuthOrAdmin(reject, token, passwords.serverIdToken).then(() => {
      console.log("getAllUsers() from "+ sanitizeString(token));
      var cUsers = dbo.collection("users");

      cUsers.find({username: {$ne: "server"}}).toArray(function(err, users) {
        if (err) reportError(reject, err);

        resolve(users);
      });
    });
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function editUser (user, context) {
  return new Promise((resolve, reject) => {
    isAuthOrMod(reject, context.req.cookies.id, user.uniqueid).then(() => {
      if (
        user.field != FieldType.rank &&
        user.field != FieldType.username &&
        user.field != FieldType.uniqueid &&
        user.field != FieldType.email &&
        user.field != FieldType.discordId &&
        user.field != FieldType.discordName &&
        user.field != FieldType.accountStatus &&
        user.field != FieldType.ipList &&
        user.field != FieldType.pc_hwid &&
        user.field != FieldType.access
      ) reportError(reject, ErrorStrings.INVALID_FIELD);
      console.log("editUser("+ user.uniqueid +", "+ user.field +", "+ user.data +") from "+ sanitizeString(context.req.cookies.id));

      var cUsers = dbo.collection("users");

      switch (user.field) {
        case FieldType.rank:
          cUsers.findOne({uniqueid: sanitizeString(context.req.cookies.id)}, function(err, myUserData) {
            if ((parseInt(myUserData.rank) >= Ranks.Admin) && (parseInt(myUserData.rank) > parseInt(user.data))) {
              cUsers.findOne({uniqueid: sanitizeString(user.uniqueid)}, function(err, editUserData) {
                request.get({url:discordAPIUrl + '/users/'+editUserData.discordId+'/rank/' + user.data, jar: serverCookie})
                .on('response', function(response) {
                  if (response.statusCode == 200) {
                    cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: {rank: user.data}}, function(err, commandResult) {
                      resolve(true);
                    });
                  } else {
                    reportError(reject, ErrorStrings.DISCORDERROR);
                  }
                });
              });
            } else {
              reportError(reject, ErrorStrings.UNAUTHORIZED);
            }
          });
          break;
        case FieldType.username:
          cUsers.findOne({uniqueid: sanitizeString(context.req.cookies.id)}, function(err, myUserData) {
            cUsers.findOne({uniqueid: sanitizeString(user.uniqueid)}, function(err, editUserData) {
              request.get({url:discordAPIUrl + '/users/'+editUserData.discordId+'/name/' + sanitizeString(user.data), jar: serverCookie})
              .on('response', function(response) {
                if (response.statusCode == 200) {
                  cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { username: sanitizeString(user.data)}}, function(err, commandResult) {
                    resolve(true);
                  });
                } else {
                  reportError(reject, ErrorStrings.DISCORDERROR);
                }
              });
            });
          });
          break;
        case FieldType.uniqueid:
          cUsers.findOne({uniqueid: sanitizeString(context.req.cookies.id)}, function(err, myUserData) {
            if (myUserData.rank >= Ranks.Admin) {
              cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { uniqueid: sanitizeString(user.data)}}, function(err, commandResult) {
                console.log(commandResult.result);
                resolve(true);
              });
            } else {
              reportError(reject, ErrorStrings.UNAUTHORIZED);
            }
          });
          break;
        case FieldType.email:
          cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { email: sanitizeString(user.data)}}, function(err, commandResult) {
            console.log(commandResult.result);
            resolve(true);
          });
          break;
        case FieldType.discordId:
          cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { discordId: sanitizeString(user.data)}}, function(err, commandResult) {
            console.log(commandResult.result);
            resolve(true);
          });
          break;
        case FieldType.discordName:
          cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { discordName: sanitizeString(user.data)}}, function(err, commandResult) {
            console.log(commandResult.result);
            resolve(true);
          });
          break;
        case FieldType.accountStatus:
          cUsers.findOne({uniqueid: sanitizeString(user.uniqueid)}, function(err, userData) {
            if (userData.rank >= Ranks.Admin && parseInt(user.data) >= parseInt(AccountStatus.Unverified) && parseInt(user.data) <= parseInt(AccountStatus.Banned)) {
              cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { accountStatus: sanitizeString(user.data)}}, function(err, commandResult) {
                console.log(commandResult.result);
                resolve(true);
              });
            } else {
              reportError(reject, ErrorStrings.UNAUTHORIZED);
            }
          });
          break;
        case FieldType.ipList:
          cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { ipList: user.data}}, function(err, commandResult) {
            console.log(commandResult.result);
            resolve(true);
          });
          break;
        case FieldType.pc_hwid:
          cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { pc_hwid: user.data}}, function(err, commandResult) {
            console.log(commandResult.result);
            resolve(true);
          });
          break;
        case FieldType.access:
          cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { access: user.data}}, function(err, commandResult) {
            console.log(commandResult.result);
            resolve(true);
          });
          break;
        default:
          reportError(reject, ErrorStrings.INVALID_FIELD);
      }
    });
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function createUser (user, context) {
  return new Promise((resolve, reject) => {
    isAuthOrAdmin(reject, context.req.cookies.id, passwords.serverIdToken).then((isUserAuthed) => {
      if (isUserAuthed) {
        var cUsers = dbo.collection("users");

        var newUser = {
          rank: '0',
          username: user.username,
          uniqueid: uuidv4(),
          email: user.email,
          discordId: user.discordId,
          discordName: user.discordName,
          accountStatus: '0',
          ipList: [user.ip],
          pc_hwid: '',
          access: {}
        };

        cUsers.insertOne(newUser, function (err, writeStatus) {
          if (writeStatus) {
            console.log('createUser("'+ newUser.username +'", "'+ newUser.discordId +'", "'+ user.ip +'")');
            resolve(true);
          } else {
            console.log(writeStatus);
            reportError(reject, ErrorStrings.UNKNOWN);
          }
        });
      } else {
        reportError(reject, ErrorStrings.UNAUTHORIZED);
      }
    });
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function isAuthOrMod(oReject, reqID, userID) {
  console.log(reqID);
  console.log(userID);
  return new Promise((resolve, reject) => {
    var cUsers = dbo.collection("users");
    cUsers.findOne({uniqueid: sanitizeString(reqID)}, function(err, user) {
      if (err) {
        console.log(err);
        reportError(oReject, ErrorStrings.UNKNOWN);
      } else if (user == null) {
        reportError(oReject, ErrorStrings.INVALID_ID);
      } else if (!user.hasOwnProperty('rank')) {
        reportError(oReject, ErrorStrings.UNKNOWN);
      } else if (reqID == userID || parseInt(user.rank) >= parseInt(Ranks.Moderator)) {
        resolve(true);
      } else {
        reportError(oReject, ErrorStrings.UNAUTHORIZED);
      }
    });
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function isAuthOrAdmin(oReject, reqID, userID) {
  return new Promise((resolve, reject) => {
    var cUsers = dbo.collection("users");
    cUsers.findOne({uniqueid: sanitizeString(reqID)}, function(err, user) {
      if (err) {
        console.log(err);
        reportError(oReject, ErrorStrings.UNKNOWN);
      } else if (user == null) {
        reportError(oReject, ErrorStrings.INVALID_ID);
      } else if (!user.hasOwnProperty('rank')) {
        reportError(oReject, ErrorStrings.UNKNOWN);
      } else if (reqID == userID || parseInt(user.rank) >= parseInt(Ranks.Admin)) {
        resolve(true);
      } else {
        reportError(oReject, ErrorStrings.UNAUTHORIZED);
      }
    });
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function reportError(reject, errMsg) {
  console.log(errMsg);
  reject(new Error(errMsg));
}

function sanitizeString(unsanitaryString) {
  if (unsanitaryString == null)
    return '';

  return unsanitaryString.replace(/[^\w\s_.:!@#-]/, "");
}

//============================ Enums and Classes ==============================

const Ranks = {
  Guest: '0',
  Newbie: '1',
  Regular: '2',
  Veteran: '3',
  Moderator: '4',
  Developer: '5',
  Admin: '6',
  Owner: '7'
}

const AccountStatus = {
  Unverified: '0',
  Verified: '1',
  Banned: '2'
}

const SearchTypes = {
  uniqueid: "uniqueid",
  discordId: "discordId",
  username: "username",
  email: "email"
}

const FieldType = {
  rank: "rank",
  username: "username",
  uniqueid: "uniqueid",
  email: "email",
  discordId: "discordId",
  discordName: "discordName",
  accountStatus: "accountStatus",
  ipList: "ipList",
  pc_hwid: "pc_hwid",
  access: "access"
}

const ErrorStrings = {
  INVALID_FIELD: "INVALID_FIELD",
  INVALID_ID: "INVALID_ID",
  INVALID_SEARCH: "INVALID_SEARCH",
  INVALID_USER: "INVALID_USER",
  UNAUTHORIZED: "UNAUTHORIZED",
  UNKNOWN: "UNKNOWN"
}
