var packageInfo = require('./package.json');
var express = require('express');
var app = express();
var cookieParser = require('cookie-parser');
var passwords = require('./passwords.json');
var uuidv4 = require('uuid/v4');
var MongoClient = require('mongodb').MongoClient;
var Mongo = require('mongodb');
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

  type Access{
    games: [Game]
  }

  type User{
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
      reject({error: "User Not Authorized to access this Data"});
    }

    console.log('getUser(' + search.type + ', ' + search.identifier + ') from ' + context.req.cookies.id);
    var cUsers = dbo.collection("users");

    switch (search.type) {
      case SearchTypes.uniqueid:
        resolve(new Promise((resolve, reject) => {
          cUsers.findOne({uniqueid: search.identifier}, function(err, res) {
            if (err) reject(err);
            if (res == null) {
              return reportError(reject, "Invalid Search");
            } else {
              isAuthOrMod(context.req.cookies.id, res.uniqueid).then((isUserAuthed) => {
                if (isUserAuthed) {
                  resolve(res);
                } else {
                  reportError(reject, "User Not Authorized to access this Data");
                }
              });
            }
          });
        }));
        break;
      case SearchTypes.discordId:
        resolve(new Promise((resolve, reject) => {
          cUsers.findOne({discordId: search.identifier}, function(err, res) {
            if (err) reject(err);
            if (res == null) {
              reportError(reject, "Invalid Search");
            } else {
              isAuthOrMod(context.req.cookies.id, res.uniqueid).then((isUserAuthed) => {
                if (isUserAuthed) {
                  resolve(res);
                } else {
                  reportError(reject, "User Not Authorized to access this Data");
                }
              });
            }
          });
        }));
        break;
      case SearchTypes.username:
        resolve(new Promise((resolve, reject) => {
          cUsers.findOne({username: search.identifier}, function(err, res) {
            console.log(search.identifier);
            if (err) reject(err);

            if (res == null) {
              reportError(reject, "Invalid Search");
            } else {
              isAuthOrMod(context.req.cookies.id, res.uniqueid).then((isUserAuthed) => {
                console.log(isUserAuthed);
                if (isUserAuthed) {
                  resolve(res);
                } else {
                  reportError(reject, "User Not Authorized to access this Data");
                }
              });
            }
          });
        }));
        break;
      case SearchTypes.email:
        resolve(new Promise((resolve, reject) => {
          cUsers.findOne({email: search.identifier}, function(err, res) {
            if (err) reject(err);
            if (res == null) {
              reportError(reject, "Invalid Search");
            } else {
              isAuthOrMod(context.req.cookies.id, res.uniqueid).then((isUserAuthed) => {
                if (isUserAuthed) {
                  resolve(res);
                } else {
                  return reportError("User Not Authorized to access this Data");
                }
              });
            }
          });
        }));
        break;
      default:
        reportError(reject, "Invalid Search Type");
    }
  });
}

function getAllUsers(token, context) {
  return new Promise((resolve, reject) => {
    console.log(token);
    isAuthOrAdmin(token, passwords.serverIdToken).then((isUserAuthed) => {
      if (isUserAuthed) {

        console.log("getAllUsers() from "+ sanitizeString(context.req.cookies.id));
        var cUsers = dbo.collection("users");

        cUsers.find({username: {$ne: "server"}}).toArray(function(err, users) {
          if (err) reportError(reject, err);

          resolve(users);
        });
      } else {
        reportError(reject, "User Not Authorized to access this Data");
      }
    });
  }).catch((error) => {
    console.log(error);
    return false;
  });
}

function editUser (user, context) {
  return new Promise((resolve, reject) => {
    isAuthOrMod(context.req.cookies.id, user.uniqueid).then((isUserAuthed) => {
      if (isUserAuthed) {
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
        ) reportError(reject, "Invalid User Field");
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
                reportError(reject, "User Not Authorized to change this Data");
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
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { uniqueid: sanitizeString(user.data)}}, function(err, commandResult) {
              console.log(commandResult.result);
              resolve(true);
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
                reportError(reject, "User Not Authorized to change this Data");
              }
            });
            break;
          case FieldType.ipList:
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { ipList: user.data}}, function(err, commandResult) {
              console.log(commandResult.result);
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
            reportError(reject, "Invalid Field Type");
        }
      } else {
        reportError(reject, "User Not Authorized to access this Data");
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

        cUsers.insertOne({
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
        }, function (err, writeStatus) {
          if (writeStatus) {
            console.log('createUser("'+ user.username +'", "'+ user.discordId +'", "'+ user.ip +'")');
            resolve(true);
          } else {
            console.log(writeStatus);
            reportError(reject, "There was an error creating the user");
          }
        });
      } else {
        reportError(reject, "User Not Authorized to access this Data");
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
        reportError(reject, "Error Authorizing (" + reqID + "): ");
      } else if (user == null) {
        reportError(reject, "Invalid User");
      } else if (reqID == userID || user.rank >= Ranks.Moderator) {
        resolve(true);
      } else {
        reportError(reject, "Failed to authorize " + reqID);
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
        reportError(reject, "Error Authorizing (" + reqID + "): ");
      } else if (user == null) {
        reportError(reject, "Invalid User");
      } else if (reqID == userID || user.rank >= Ranks.Admin) {
        resolve(true);
      } else {
        reportError(reject, "Failed to authorize " + reqID);
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

function isHex(unknownString) {
  if ((/[0-9A-Fa-f]{6}/g).test(unknownString)) {
      return true;
  } else {
      return false;
  }
}

//============================ Enums and Classes ==============================
const APIStatus = {
  Success: 204,
  Accepted: 202,
  ClientError: 400,
  NoID: 511,
  LowRank: 401,
  InvalidArguments: 406,
  Spam: 429,
  ServerError: 500,
  NotImplemented: 501
}

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
