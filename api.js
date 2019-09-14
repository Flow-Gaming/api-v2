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
    rank: Int
    username: String
    uniqueid: String
    email: String
    discordName: String
    discordId: String
    accountStatus: Int
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
  }

  type Mutation {
    editUser(uniqueid: String!, field: FieldType!, data: String!): Boolean
  }
`);

var root = {
  getUser: function (search, context) {
    if (search.id == "0")
      return;

    return getUser({type: search.search, identifier: search.id}, context);
  },

  editUser: function (user, context){
    return editUser(user, context);
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
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { rank: user.data}}, function(err, commandResult) {
              console.log(commandResult.result);
              resolve(true);
            });
            break;
          case FieldType.username:
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { username: user.data}}, function(err, commandResult) {
              console.log(commandResult.result);
              resolve(true);
            });
            break;
          case FieldType.uniqueid:
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { uniqueid: user.data}}, function(err, commandResult) {
              console.log(commandResult.result);
              resolve(true);
            });
            break;
          case FieldType.email:
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { email: user.data}}, function(err, commandResult) {
              console.log(commandResult.result);
              resolve(true);
            });
            break;
          case FieldType.discordId:
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { discordId: user.data}}, function(err, commandResult) {
              console.log(commandResult.result);
              resolve(true);
            });
            break;
          case FieldType.discordName:
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { discordName: user.data}}, function(err, commandResult) {
              console.log(commandResult.result);
              resolve(true);
            });
            break;
          case FieldType.accountStatus:
            cUsers.updateOne({uniqueid: sanitizeString(user.uniqueid)}, {$set: { accountStatus: user.data}}, function(err, commandResult) {
              console.log(commandResult.result);
              resolve(true);
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
  Guest: 0,
  Regular: 1,
  Veteran: 2,
  Moderator: 3,
  Developer: 4,
  Admin: 5,
  Owner: 6
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
