var packageInfo = require('./package.json');
var express = require('express');
var app = express();
var cookieParser = require('cookie-parser');
var passwords = require('./passwords.json');
var uuidv4 = require('uuid/v4');
var MongoClient = require('mongodb').MongoClient;
var graphqlHTTP = require('express-graphql');
var { buildSchema } = require('graphql');

app.set('view engine', 'pug');
app.use(cookieParser());

//Docker Port 4690 - 4699
var server = undefined;
var dbo = undefined;
MongoClient.connect("mongodb://localhost:27017/", function(err, db) {
  if (err) throw err;
  dbo = db.db("flow_gaming");

  server = app.listen(4690, function () {
     console.log("API 2.0 Server listening on port "+ server.address().port)
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
    getUser(search: SearchType!, id: String!): User

    getAllUsers(serverToken: String): [User]
  }

  type Mutation {
    editUser(uniqueid: String!, field: FieldType!, data: String!): Boolean

    createUser(username: String!, email: String!, discordId: String!, discordName: String!, ip: String!): Boolean
  }
`);

var root = {
  getUser: function (search, context) {
    if (search.id == "0")
      return;

    return getUser({type: search.search, identifier: search.id}, context);
  },

  getAllUsers: function (token, context) {
    if (token.length != null) return getAllUsers(sanitizeString(token), context)
    else return getAllUsers(sanitizeString(context.req.cookies.id), context)
  },

  editUser: function (user, context) {
    return editUser(user, context);
  },

  createUser: function (user, context) {
    return createUser({username: user.username, email: user.email, discordId: user.discordId, discordName: user.discordName, ip: user.ip}, context);
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

function getUser (search, context) {
  return new Promise((resolve, reject) => {
    if (context.req == null) {
      reportError(reject, "Request is Null");
    } else if (context.req.cookies.id == null) {
      reportError(reject, ErrorStrings.INVALID_ID);
    }

    console.log('getUser(' + search.type + ', ' + search.identifier + ') from ' + context.req.cookies.id);
    var cUsers = dbo.collection("users");


    switch (search.type) {
      case SearchTypes.uniqueid:
        cUsers.findOne({uniqueid: search.identifier}, function(err, user) {
          if (err) reject(err);
          if (user == null) {
            return reportError(reject, ErrorStrings.INVALID_SEARCH);
          } else {
            isAuthOrAdmin(context.req.cookies.id, user.uniqueid).then(() => {
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
            isAuthOrAdmin(context.req.cookies.id, user.uniqueid).then(() => {
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
            isAuthOrAdmin(context.req.cookies.id, user.uniqueid).then(() => {
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
            isAuthOrAdmin(context.req.cookies.id, user.uniqueid).then(() => {
              resolve(user);
            });
          }
        });
        break;
      default:
        reportError(reject, ErrorStrings.INVALID_SEARCH);
    }
  });
}

function getAllUsers(token, context) {
  return new Promise((resolve, reject) => {
    console.log(token);
    isAuthOrAdmin(token, passwords.serverIdToken).then(() => {
      console.log("getAllUsers() from "+ sanitizeString(context.req.cookies.id));
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
    isAuthOrMod(context.req.cookies.id, user.uniqueid).then(() => {
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
              cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: {rank: user.data}}, function(err, commandResult) {
                console.log(commandResult.result);
                resolve(true);
              });
            } else {
              reportError(reject, ErrorStrings.UNAUTHORIZED);
            }
          });
          break;
        case FieldType.username:
          cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { username: sanitizeString(user.data)}}, function(err, commandResult) {
            console.log(commandResult.result);
            resolve(true);
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
            if (userData.rank >= Ranks.Admin) {
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
    isAuthOrAdmin(context.req.cookies.id, passwords.serverIdToken).then((isUserAuthed) => {
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

function isAuthOrMod(reqID, userID) {
  return new Promise((resolve, reject) => {
    var cUsers = dbo.collection("users");
    cUsers.findOne({uniqueid: sanitizeString(reqID)}, function(err, user) {
      if (err) {
        console.log(err);
        reportError(reject, ErrorStrings.UNKNOWN);
      } else if (reqID == userID || parseInt(user.rank) >= parseInt(Ranks.Moderator)) {
        resolve(true);
      } else {
        reportError(reject, ErrorStrings.UNAUTHORIZED);
      }
    });
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function isAuthOrAdmin(reqID, userID) {
  return new Promise((resolve, reject) => {
    var cUsers = dbo.collection("users");
    cUsers.findOne({uniqueid: sanitizeString(reqID)}, function(err, user) {
      if (err) {
        console.log(err);
        reportError(reject, ErrorStrings.UNKNOWN);
      } else if (reqID == userID || parseInt(user.rank) >= parseInt(Ranks.Admin)) {
        resolve(true);
      } else {
        reportError(reject, ErrorStrings.UNAUTHORIZED);
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
