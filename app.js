const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();

app.use(express.json());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("server started at 3000 port");
    });
  } catch (e) {
    console.log(`DB Error ${e}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const authenticateJwtToken = (req, res, next) => {
  const reqHeaders = req.headers["authorization"];
  if (reqHeaders !== undefined) {
    const jwtToken = reqHeaders.split(" ")[1];
    jwt.verify(jwtToken, "My_Secret_key", (error, payload) => {
      if (error) {
        res.status(401);
        res.send("Invalid JWT Token");
      } else {
        req.userId = payload.userId;
        req.username = payload.username;
        next();
      }
    });
  } else {
    res.status(401);
    res.send("Invalid JWT Token");
  }
};

const getUserLikes = (userDb) => {
  let myArray = [];
  const iterate = (each) => {
    myArray.push(each.name);
  };
  userDb.forEach((each) => iterate(each));
  return { likes: myArray };
};

const getUserReplies = (userDb) => {
  let myArray = [];
  const iterate = (each) => {
    myArray.push({ name: each.name, reply: each.reply });
  };
  userDb.forEach((each) => iterate(each));
  return { replies: myArray };
};

app.post("/register/", async (req, res) => {
  const { username, password, name, gender } = req.body;
  const userQuery = `select * from user where username like '${username}';`;
  const userDb = await db.get(userQuery);

  if (userDb === undefined) {
    if (password.length >= 6) {
      const encryptedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
          insert into user(name, username, password, gender)
          values('${name}','${username}','${encryptedPassword}','${gender}');`;
      await db.run(createUserQuery);
      res.send("User created successfully");
    } else {
      res.status(400);
      res.send("Password is too short");
    }
  } else {
    res.status(400);
    res.send("User already exists");
  }
});

app.post(/login/, async (req, res) => {
  const { username, password } = req.body;
  const userQuery = `select * from user where username like '${username}';`;
  const userDb = await db.get(userQuery);
  if (userDb !== undefined) {
    const isValidPassword = await bcrypt.compare(password, userDb.password);
    if (isValidPassword) {
      const payload = {
        username: userDb.username,
        userId: userDb.user_id,
      };
      const jwtToken = jwt.sign(payload, "My_Secret_key");
      res.send({ jwtToken });
    } else {
      res.status(400);
      res.send("Invalid password");
    }
  } else {
    res.status(400);
    res.send("Invalid user");
  }
});

// jwtToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6IkpvZUJpZGVuIiwidXNlcklkIjoyLCJpYXQiOjE2NTk5MzM2NzB9.7aWJvKvNrqB0ZG4_khDEm_fQGXf66VdGqfj7A5_0DBY

app.get("/user/tweets/feed/", authenticateJwtToken, async (req, res) => {
  const { userId } = req;
  const userFollowsQuery = `select following_user_id as followingUserId
    from follower where follower_user_id like '${userId}';`;
  const userFollowsArray = await db.all(userFollowsQuery);
  const userFollows = userFollowsArray.map((each) => each.followingUserId);
  const userFollowingTweetQuery = `
  select user.username as username,
  tweet.tweet as tweet,
  tweet.date_time as dateTime
  from user inner join tweet
  on user.user_id = tweet.user_id
  where tweet.user_id in (${userFollows})
  order by dateTime DESC
  limit 4;`;
  const userFollowingTweetArray = await db.all(userFollowingTweetQuery);
  res.send(userFollowingTweetArray);
});

app.get("/user/following/", authenticateJwtToken, async (request, response) => {
  const { userId } = request;
  const userFollowsQuery = `select following_user_id as followingUserId
    from follower where follower_user_id like '${userId}';`;
  const userFollowsArray = await db.all(userFollowsQuery);
  const userFollows = userFollowsArray.map((each) => each.followingUserId);

  const userFollowingNames = `SELECT name FROM user WHERE user_id IN (${userFollows});`;
  const followingNames = await db.all(userFollowingNames);
  response.send(followingNames);
});

app.get("/user/followers/", authenticateJwtToken, async (request, response) => {
  const { userId } = request;
  const getUserFollowers = `
    SELECT follower_user_id FROM follower 
    WHERE following_user_id LIKE ${userId};`;
  const userFollowersUserId = await db.all(getUserFollowers);
  const userFollowersArray = userFollowersUserId.map((each) => {
    return each.follower_user_id;
  });
  const getUserFollowersQuery = `
    SELECT 
    name
    FROM user
    WHERE user_id IN (${userFollowersArray});`;
  const userFollowers = await db.all(getUserFollowersQuery);
  response.send(userFollowers);
});

// Get All The User Following Replies API
app.get(
  "/tweets/:tweetId/",
  authenticateJwtToken,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;
    const getUserFollowingUsers = `
    SELECT following_user_id FROM follower 
    WHERE follower_user_id LIKE ${userId};`;
    const userFollowingUserId = await db.all(getUserFollowingUsers);

    const userFollowingArray = userFollowingUserId.map((each) => {
      return each.following_user_id;
    });
    const getUserFollowingTweetQuery = `
    SELECT tweet_id FROM tweet
    WHERE user_id IN (${userFollowingArray});`;
    const followingUserTweets = await db.all(getUserFollowingTweetQuery);

    const followingUserTweetArray = followingUserTweets.map((each) => {
      return each.tweet_id;
    });
    if (followingUserTweetArray.includes(parseInt(tweetId))) {
      const getTotalLikes = `
            SELECT COUNT(user_id) AS likes_count
            FROM like 
            WHERE tweet_id LIKE ${tweetId};`;
      const totalLikes = await db.get(getTotalLikes);
      const getTotalReplies = `
            SELECT COUNT(reply) AS reply_count
            FROM reply 
            WHERE tweet_id LIKE ${tweetId};`;
      const totalReplies = await db.get(getTotalReplies);
      const getTweetData = `
            SELECT tweet, date_time
            FROM tweet
            WHERE tweet_id LIKE ${tweetId};`;
      const tweetData = await db.get(getTweetData);
      response.send({
        tweet: tweetData.tweet,
        likes: totalLikes.likes_count,
        replies: totalReplies.reply_count,
        dateTime: tweetData.date_time,
      });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//If the user requests a tweet of a user he is following, return the list of usernames who liked the tweet

app.get(
  "/tweets/:tweetId/likes/",
  authenticateJwtToken,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;
    const getUserFollowingUsers = `
    SELECT following_user_id FROM follower 
    WHERE follower_user_id LIKE ${userId};`;
    const userFollowingUserId = await db.all(getUserFollowingUsers);

    const userFollowingArray = userFollowingUserId.map((each) => {
      return each.following_user_id;
    });
    const getUserFollowingTweetQuery = `
    SELECT tweet_id FROM tweet
    WHERE user_id IN (${userFollowingArray});`;
    const followingUserTweets = await db.all(getUserFollowingTweetQuery);

    const followingUserTweetArray = followingUserTweets.map((each) => {
      return each.tweet_id;
    });
    if (followingUserTweetArray.includes(parseInt(tweetId))) {
      const getUserLikesQuery = `
        SELECT
        user.username AS name
        FROM like INNER JOIN 
        user ON user.user_id = like.user_id
        WHERE like.tweet_id LIKE ${tweetId};`;
      const userLikes = await db.all(getUserLikesQuery);
      response.send(getUserLikes(userLikes));
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//If the user requests a tweet of a user he is following, return the list of replies.

app.get(
  "/tweets/:tweetId/replies/",
  authenticateJwtToken,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;

    const getUserFollowingUsers = `
    SELECT following_user_id FROM follower 
    WHERE follower_user_id LIKE ${userId};`;
    const userFollowingUserId = await db.all(getUserFollowingUsers);

    const userFollowingArray = userFollowingUserId.map((each) => {
      return each.following_user_id;
    });
    const getUserFollowingTweetQuery = `
    SELECT tweet_id FROM tweet
    WHERE user_id IN (${userFollowingArray});`;
    const followingUserTweets = await db.all(getUserFollowingTweetQuery);

    const followingUserTweetArray = followingUserTweets.map((each) => {
      return each.tweet_id;
    });
    if (followingUserTweetArray.includes(parseInt(tweetId))) {
      const getUserRepliesQuery = `
          SELECT
            user.name,
            reply.reply
            FROM user INNER JOIN 
            reply ON user.user_id = reply.user_id
            WHERE reply.tweet_id LIKE ${tweetId};`;
      const userReplies = await db.all(getUserRepliesQuery);
      response.send(getUserReplies(userReplies));
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//Returns a list of all tweets of the user

app.get("/user/tweets/", authenticateJwtToken, async (request, response) => {
  const { userId } = request;
  const getTweetsOfUser = `
  SELECT tweet_id FROM tweet
  WHERE user_id LIKE ${userId};`;
  const userTweets = await db.all(getTweetsOfUser);
  const userTweetsArray = userTweets.map((each) => {
    return each.tweet_id;
  });
  const tweetDataQuery = `
            SELECT tweet.tweet,
            COUNT(distinct like.user_id) AS likes,
            COUNT(distinct reply.reply_id) AS replies,
            tweet.date_time AS dateTime
            FROM ( tweet LEFT JOIN like
            ON tweet.tweet_id = like.tweet_id ) AS T
            LEFT JOIN reply ON T.tweet_id = reply.tweet_id
            WHERE tweet.tweet_id In (${userTweetsArray})
            GROUP BY tweet.tweet_id;`;
  const tweetData = await db.all(tweetDataQuery);
  response.send(tweetData);
});

//CREATE Tweet API

app.post("/user/tweets/", authenticateJwtToken, async (request, response) => {
  const { userId } = request;
  const { tweet } = request.body;
  const date = new Date();
  const dateTime = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
  const createUserTweetQuery = `
  INSERT INTO tweet (tweet,user_id,date_time)
  VALUES(
      '${tweet}',
       ${userId},
      '${dateTime}'
  )`;
  await db.run(createUserTweetQuery);
  response.send("Created a Tweet");
});

const isUser = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `
    SELECT DISTINCT(user_id) FROM tweet
    WHERE tweet_id LIKE ${tweetId};`;
  const userDb = await db.get(getTweetQuery);
  if (userDb === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    if (userDb.user_id === userId) {
      next();
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
};

//Delete Tweet API

app.delete(
  "/tweets/:tweetId",
  authenticateJwtToken,
  isUser,
  async (request, response) => {
    const { userId } = request;
    const { tweetId } = request.params;
    const deleteUserTweetQuery = `
  DELETE FROM tweet
  WHERE tweet_id LIKE ${tweetId}`;
    await db.run(deleteUserTweetQuery);
    response.send("Tweet Removed");
  }
);

module.exports = app;
