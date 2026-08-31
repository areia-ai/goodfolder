# GoodFolder CLI

The GoodFolder CLI works on the computer that holds the folder. It connects a
folder, makes Saves, carries work to another approved computer, and lets you
return to an earlier Save.

When this package is released, install it with:

```bash
npm install -g @goodfolder/cli
```

For GoodFolder Hosted, sign in and start a trial before connecting a folder.
Then, from the folder you want to protect:

```bash
goodfolder connect
```

The command opens a browser once so you can approve that computer. To use a
server you run yourself, set `GF_API_URL` before the first connection.

This package is kept private until the Hosted trial flow has passed live
Stripe testing and the release is explicitly approved.
