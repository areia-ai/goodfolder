# GoodFolder CLI

The GoodFolder CLI works on the computer that holds the folder. It connects a
folder, makes Saves, carries work to another approved computer, and lets you
return to an earlier Save.

Install it with:

```bash
npm install -g @goodfolder/cli
```

For GoodFolder Hosted, sign in and start a trial before connecting a folder.
Then, from the folder you want to protect:

```bash
goodfolder connect
```

The command opens a browser once so you can approve that computer.

## Running your own server

Point the first connection at your own GoodFolder server with `GF_API_URL`:

```bash
GF_API_URL=http://localhost:4100 goodfolder connect ~/some-folder
```

A folder remembers the server it was set up against, so you only need the
variable for that first connection.
