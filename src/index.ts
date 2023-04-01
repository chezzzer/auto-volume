import express, { Request, Response } from "express";
import fs from "fs";
import Spotify from "spotify-web-api-node";
import open from "open";
import "dotenv/config";
import { Track } from "spotify-types";
import path from "path";

if (!fs.existsSync("VOLUME")) {
    fs.writeFileSync("VOLUME", "0.3", "utf-8");
}
var average_volume = Number(fs.readFileSync("VOLUME"));

let current: Track;

const spotify = new Spotify({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT,
});

async function refreshToken() {
    try {
        const token = await spotify.refreshAccessToken();
        spotify.setAccessToken(token.body.access_token);
    } catch (_) {
        refreshToken();
    }
}

async function main() {
    try {
        const state = await spotify.getMyCurrentPlaybackState();

        if (current?.id !== state.body.item?.id) {
            current = state.body.item as any;

            await autoVolume();
        }
    } catch (_) {}
}

async function autoVolume() {
    const analysis = await spotify.getAudioFeaturesForTrack(current.id);
    const { loudness } = analysis.body;

    const percent = loudness / -60;

    const calculatedPercent = Math.floor((average_volume + percent) * 100);

    console.log(`Loudness: ${loudness}db\nNew Volume: ${calculatedPercent}%`);

    await spotify.setVolume(calculatedPercent);
}

const app = express();

app.use(express.static(path.join(path.resolve(), "src/public")));

app.post("/api/volume/:volume", (req: Request, res: Response) => {
    if (isNaN(Number(req.params.volume))) {
        return res.end("Not a number");
    }

    fs.writeFileSync("VOLUME", req.params.volume);
    average_volume = Number(req.params.volume);

    autoVolume();

    res.end(`Average volume updated to ${req.params.volume}`);
});

app.get("/api/volume", (req: Request, res: Response) => {
    res.end(average_volume.toString());
});

if (fs.existsSync("TOKEN") || process.env.SPOTIFY_REFRESH) {
    const refresh =
        fs.readFileSync("TOKEN", "utf-8") || process.env.SPOTIFY_REFRESH;
    spotify.setRefreshToken(refresh!);
    await refreshToken();

    setInterval(refreshToken, 59 * 60 * 1000);
    setInterval(main, 1 * 1000);
} else {
    const url = spotify.createAuthorizeURL(
        ["user-modify-playback-state", "user-read-playback-state"],
        "g3yb8547g485"
    );
    open(url);
    console.log(url);

    app.get("/api/callback", async (req: Request, res: Response) => {
        const auth = await spotify.authorizationCodeGrant(
            req.query.code as string
        );

        const token = auth.body;

        fs.writeFileSync("TOKEN", token.refresh_token);

        spotify.setRefreshToken(token.refresh_token);
        spotify.setAccessToken(token.access_token);

        setInterval(main, 1 * 1000);

        res.end("Success, now tracking.");
    });
}

app.listen(process.env.PORT || 3000, () => {
    console.log("Listening");
});
