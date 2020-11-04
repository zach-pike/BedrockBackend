var controlPannelPort = process.argv[2];
var logFile = process.argv[3];
var serverDirectory = process.argv[4];

var { execFile } = require('child_process'); 
var app = require('express')();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var fs = require('fs');
var propertiesReader = require('properties-reader');

//server properties file 
var serverProperties = propertiesReader(serverDirectory + '/server.properties', {writer: { saveSections: true }});
//the child process variables
var child;

var login = []
var authed = false;


fs.readFile('login.json', (err, data) => {
    if (err) throw err;
    let loginInfo = JSON.parse(data);
    login.push(loginInfo.login.username);
    login.push(loginInfo.login.password);
});

//variables used in the code
var online = [];
var serverRunning = false;
var lineBuffer = "";
var shutdownOnMessage = true;

//express http things are here
app.get('/', (req, res) => {
    if (authed == true) {
        res.sendFile(__dirname + '/html/homePage.html');
        authed = false;
    } else {
        res.sendFile(__dirname + '/html/index.html');
    }
});
app.get('/console', (req, res) => {
    res.sendFile(__dirname + '/html/console.html');
});
app.get('/propertyControl', (req, res) => {
    res.sendFile(__dirname + '/html/property.html');
});
app.get('/controls', (req, res) => {
    res.sendFile(__dirname + '/html/controls.html');
});
app.get('/favicon.ico', (req, res) => {
    res.sendFile(__dirname + '/favicon.ico');
});
app.get('/online', (req, res) => {
    res.sendFile(__dirname + '/html/online.html');
});
http.listen(controlPannelPort, () => {
    console.log('listening on *:' + controlPannelPort);
    log(dateTime() + " http server opened");
});

//logging functions
function log(text) {
    //add to file
    fs.appendFileSync(logFile, "\n" + text, function (err) { if (err) throw err; });
}
function dateTime() {
    //date thing
    var date = new Date();
    let dateThing = date.getMonth() + "/" + date.getDate() + "/" + date.getFullYear() + " At " + date.getHours() + ":" + date.getMinutes() + ";" + date.getSeconds();
    return dateThing;
}
//custom command for the console
function customCommand(data) {
    io.emit('console message', "Client: " + data);
    log(dateTime() + " Web interface ran: " + data);
    console.log("WebClient ran: " + data);

    //custom command for the server
    if (data.toString().startsWith('*')) {
        //gets whos online
        if (data.toString().split("*")[1] == "whosonline") {
            let string = "";
            string += "There are " + online.length + " person(s) online: ";
            if (online.length > 0) {
                for (let i=0; i < online.length; i++) {
                    if (online.length < 2) {
                        string += online[i];
                    } else {
                        if (i < online.length-1) {
                            string += online[i] + ", ";
                        } else {
                            string += "and " + online[i];
                        }
                    }
                }
                io.emit('console message', string)
            } else {
                io.emit('console message', 'No one is online!')
            }
        } 
    } else {
        runCommand(data);
    }
}
//run command on the server fucntion
function runCommand(command) {
    child.stdin.write(command + "\n");
    if (command == 'stop') {
        serverRunning = false;
    }
}
//property updater
function propertyUpdater(data) {
    log(dateTime() + " WebClient updated the server properties")
    if (data.propertyReq == true) {
        var propertys = serverProperties.getAllProperties();
        io.emit('property', propertys);
    } else {
        var keys = Object.entries(data.propertys);
        for (let i=0; i < keys.length; i++) {
            serverProperties.set(keys[i][0], keys[i][1]);
        }
        serverProperties.save(serverDirectory + '/server.properties');
        log(dateTime() + " Restarting Server...");
        stopServer();
        setTimeout(function () {
            startServer();
        }, 5000);
    }
}

function stopServer() {
    log(dateTime() + " Stopping server");
    shutdownOnMessage = false;
    runCommand('stop');
    serverRunning = false;
    online = [];
}

function controlServer(data) {
    if (data.stateReq == true) {
        io.emit('control', {
            "state": serverRunning,
            "online": online, 
            "stateUpdate": true
        });
    } else {
        log(dateTime() + " Running server command: " + data.newState);
        switch (data.newState) {
            case "stopMC":
                io.emit('console message', 'Stopping Minecraft Server');
                stopServer();
                break;
            case "startMC":
                io.emit('console message', 'Starting Minecraft Server');
                startServer();
                break;
            case "restart":
                io.emit('console message', 'Restarting Minecraft Server');
                stopServer();
                setTimeout(function () {
                    startServer();
                }, 5000);
                break;
            case "stopAll":
                io.emit('console message', 'Stopping everything');
                stopServer();
                break;
        }
    }
}

function auth() {
    if (msg.username == login[0] && msg.password == login[1]) {
        authed = true;
    } else {
        authed = false;
    }
}

//socket.io handler
io.on('connection', (socket) => {
    socket.on('console message', (msg) => {
        customCommand(msg)
    });
    socket.on('property', (msg) => {
        propertyUpdater(msg)
    });
    socket.on('control', (msg) => {
        controlServer(msg)
    })
    socket.on('login', (msg) => {
        auth();
    })
});

function startServer() {
    child = execFile(serverDirectory + '/bedrock_server.exe', []);
    serverRunning = true;
    shutdownOnMessage = true;
    // use event hooks to provide sa callback to execute when data are available: 
    child.stdout.on('data', function(data) {
        //keeps adding to the line buffer from the data stream
        lineBuffer += data.toString();

        //if theres a complete line in the line buffer, use it
        if (lineBuffer.endsWith('\n')) {
            //get rid of thoes fucking autocomapction things
            if (lineBuffer.indexOf("Running AutoCompaction...") ==-1) {
                console.log("Server: " + lineBuffer); // log it
                io.emit('console message', "Server: " + lineBuffer); // put what the server said on the thing
                log(dateTime() + " Server output: " + lineBuffer); 
            }

            //if somebody joins, alert me 
            if (lineBuffer.indexOf('Player') !=-1 && lineBuffer.indexOf('xuid:') !=-1) {
                var connectedVal = lineBuffer.split(' ')[4].split(':')[0];
                var name = lineBuffer.split(' ')[5].split(',')[0];

                //keeps a list of who logs on
                if (connectedVal == 'connected') {
                    online.push(name);
                } else if (connectedVal == 'disconnected') {
                    online.splice(online.indexOf(name), 1);
                }

            } else if (lineBuffer.indexOf("Quit correctly") !=-1 && shutdownOnMessage == true) {
                log(dateTime() + " Server Stopping!");
                setTimeout(function () {
                    process.exit();
                }, 500);
            }
        //clears line buffer
        lineBuffer = "";
        } 
    });
}

startServer();
log("Start of log! " + dateTime());