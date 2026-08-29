-- Creates the GoodFolder control-plane database alongside Gitea's.
CREATE USER goodfolder WITH PASSWORD :'GOODFOLDER_DB_PASSWORD';
CREATE DATABASE goodfolder OWNER goodfolder;
