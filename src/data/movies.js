const catalog = [
  {
    id: "stranger-things",
    title: "Stranger Things",
    type: "series",
    rating: 9.2,
    match: "99% Match",
    year: "2024",
    genres: ["Sci-Fi", "Horror", "Drama"],
    description: "When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl with telekinetic powers.",
    creator: "The Duffer Brothers",
    cast: ["Millie Bobby Brown", "Finn Wolfhard", "Winona Ryder", "David Harbour"],
    bannerGradient: "linear-gradient(135deg, #1f0837 0%, #0c0014 100%)",
    accentColor: "#FF007A",
    iconDoodle: "waffle", // Waffle or Demogorgon doodle name
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            episodeNumber: 1,
            title: "Chapter One: The Vanishing of Will Byers",
            duration: "47 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
          },
          {
            episodeNumber: 2,
            title: "Chapter Two: The Weirdo on Maple Street",
            duration: "55 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
          },
          {
            episodeNumber: 3,
            title: "Chapter Three: Holly, Jolly",
            duration: "51 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
          }
        ]
      },
      {
        seasonNumber: 2,
        episodes: [
          {
            episodeNumber: 1,
            title: "Chapter One: Madmax",
            duration: "48 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"
          },
          {
            episodeNumber: 2,
            title: "Chapter Two: Trick or Treat, Freak",
            duration: "56 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"
          }
        ]
      }
    ]
  },
  {
    id: "spider-man-spiderverse",
    title: "Spider-Man: Into the Spider-Verse",
    type: "movie",
    rating: 8.4,
    match: "98% Match",
    year: "2018",
    duration: "1h 57m",
    genres: ["Action", "Sci-Fi", "Animation"],
    description: "Teen Miles Morales becomes the Spider-Man of his universe, and must join with five spider-powered individuals from other dimensions to stop a threat for all realities.",
    creator: "Bob Persichetti, Peter Ramsey",
    cast: ["Shameik Moore", "Jake Johnson", "Hailee Steinfeld", "Mahershala Ali"],
    bannerGradient: "linear-gradient(135deg, #FF0055 0%, #001035 100%)",
    accentColor: "#00E5FF",
    iconDoodle: "spider",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"
  },
  {
    id: "wednesday",
    title: "Wednesday",
    type: "series",
    rating: 8.1,
    match: "95% Match",
    year: "2022",
    genres: ["Horror", "Comedy", "Mystery"],
    description: "Smart, sarcastic and a little dead inside, Wednesday Addams investigates a murder spree while making new friends — and foes — at Nevermore Academy.",
    creator: "Alfred Gough, Miles Millar",
    cast: ["Jenna Ortega", "Emma Myers", "Hunter Doohan", "Christina Ricci"],
    bannerGradient: "linear-gradient(135deg, #1a1c23 0%, #050608 100%)",
    accentColor: "#FFEE32",
    iconDoodle: "hand", // Thing hand
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            episodeNumber: 1,
            title: "Wednesday's Child Is Full of Woe",
            duration: "59 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4"
          },
          {
            episodeNumber: 2,
            title: "Woe Is the Loneliest Number",
            duration: "48 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4"
          }
        ]
      }
    ]
  },
  {
    id: "dune-part-two",
    title: "Dune: Part Two",
    type: "movie",
    rating: 8.6,
    match: "97% Match",
    year: "2024",
    duration: "2h 46m",
    genres: ["Sci-Fi", "Drama", "Action"],
    description: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the universe.",
    creator: "Denis Villeneuve",
    cast: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson", "Austin Butler"],
    bannerGradient: "linear-gradient(135deg, #D4A373 0%, #1A130E 100%)",
    accentColor: "#FF6B00",
    iconDoodle: "worm",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4"
  },
  {
    id: "rick-and-morty",
    title: "Rick and Morty",
    type: "series",
    rating: 9.1,
    match: "96% Match",
    year: "2023",
    genres: ["Comedy", "Sci-Fi", "Animation"],
    description: "An animated series that follows the exploits of a super scientist and his easily influenced grandson, who split their time between domestic family life and interdimensional adventures.",
    creator: "Dan Harmon, Justin Roiland",
    cast: ["Justin Roiland", "Chris Parnell", "Spencer Grammer", "Sarah Chalke"],
    bannerGradient: "linear-gradient(135deg, #112F20 0%, #060e0a 100%)",
    accentColor: "#39FF14",
    iconDoodle: "portal",
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            episodeNumber: 1,
            title: "Pilot",
            duration: "22 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
          },
          {
            episodeNumber: 2,
            title: "Lawnmower Dog",
            duration: "22 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
          }
        ]
      }
    ]
  },
  {
    id: "squid-game",
    title: "Squid Game",
    type: "series",
    rating: 8.0,
    match: "94% Match",
    year: "2021",
    genres: ["Thriller", "Drama", "Mystery"],
    description: "Hundreds of cash-strapped players accept a strange invitation to compete in children's games. Inside, a tempting prize awaits with deadly high stakes. A survival game that has a super high cost.",
    creator: "Hwang Dong-hyuk",
    cast: ["Lee Jung-jae", "Park Hae-soo", "Wi Ha-joon", "Jung Ho-yeon"],
    bannerGradient: "linear-gradient(135deg, #3C091C 0%, #0F0206 100%)",
    accentColor: "#FF007A",
    iconDoodle: "squid-mask",
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            episodeNumber: 1,
            title: "Red Light, Green Light",
            duration: "60 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4"
          },
          {
            episodeNumber: 2,
            title: "Hell",
            duration: "63 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"
          }
        ]
      }
    ]
  },
  {
    id: "everything-everywhere",
    title: "Everything Everywhere All at Once",
    type: "movie",
    rating: 8.8,
    match: "99% Match",
    year: "2022",
    duration: "2h 19m",
    genres: ["Comedy", "Sci-Fi", "Action"],
    description: "A middle-aged Chinese immigrant is swept up into an insane adventure in which she alone can save existence by exploring other universes and connecting with the lives she could have led.",
    creator: "Daniel Kwan, Daniel Scheinert",
    cast: ["Michelle Yeoh", "Ke Huy Quan", "Stephanie Hsu", "Jamie Lee Curtis"],
    bannerGradient: "linear-gradient(135deg, #1C052A 0%, #3B0909 100%)",
    accentColor: "#FFEE32",
    iconDoodle: "googly-eye",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
  },
  {
    id: "knives-out",
    title: "Knives Out",
    type: "movie",
    rating: 7.9,
    match: "92% Match",
    year: "2019",
    duration: "2h 10m",
    genres: ["Comedy", "Mystery", "Drama"],
    description: "A detective investigates the death of the patriarch of an eccentric, combative family. Everyone is a suspect, and Benoit Blanc must unravel a web of lies, secrets, and red herrings.",
    creator: "Rian Johnson",
    cast: ["Daniel Craig", "Chris Evans", "Ana de Armas", "Jamie Lee Curtis"],
    bannerGradient: "linear-gradient(135deg, #1F303A 0%, #0A1116 100%)",
    accentColor: "#FF6B00",
    iconDoodle: "magnifier",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4"
  },
  {
    id: "interstellar",
    title: "Interstellar",
    type: "movie",
    rating: 8.7,
    match: "98% Match",
    year: "2014",
    duration: "2h 49m",
    genres: ["Sci-Fi", "Drama", "Adventure"],
    description: "When Earth becomes uninhabitable, a team of explorers travels through a wormhole in space in an attempt to ensure humanity's survival on distant worlds.",
    creator: "Christopher Nolan",
    cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain", "Michael Caine"],
    bannerGradient: "linear-gradient(135deg, #091322 0%, #02050B 100%)",
    accentColor: "#00E5FF",
    iconDoodle: "galaxy",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
  },
  {
    id: "arcane",
    title: "Arcane",
    type: "series",
    rating: 9.0,
    match: "99% Match",
    year: "2021",
    genres: ["Action", "Sci-Fi", "Animation"],
    description: "Set in the utopian region of Piltover and the oppressed underground of Zaun, the story follows the origins of two iconic League champions-and the power that will tear them apart.",
    creator: "Christian Linke, Alex Yee",
    cast: ["Hailee Steinfeld", "Ella Purnell", "Kevin Alejandro", "Harry Lloyd"],
    bannerGradient: "linear-gradient(135deg, #092842 0%, #030D16 100%)",
    accentColor: "#FF007A",
    iconDoodle: "gear",
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            episodeNumber: 1,
            title: "Welcome to the Playground",
            duration: "43 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"
          },
          {
            episodeNumber: 2,
            title: "Some Mysteries Are Better Left Unsolved",
            duration: "40 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"
          }
        ]
      }
    ]
  },
  {
    id: "demon-slayer",
    title: "Demon Slayer: Kimetsu no Yaiba",
    type: "series",
    rating: 8.7,
    match: "97% Match",
    year: "2019",
    genres: ["Action", "Fantasy", "Animation"],
    description: "A family is attacked by demons and only two members survive - Tanjiro and his sister Nezuko, who is slowly turning into a demon. Tanjiro sets out to become a demon slayer to avenge his family and cure his sister.",
    creator: "Koyoharu Gotouge",
    cast: ["Natsuki Hanae", "Akari Kito", "Yoshitsugu Matsuoka", "Hiro Shimono"],
    bannerGradient: "linear-gradient(135deg, #420A0A 0%, #140202 100%)",
    accentColor: "#FFEE32",
    iconDoodle: "sword",
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            episodeNumber: 1,
            title: "Cruelty",
            duration: "25 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
          },
          {
            episodeNumber: 2,
            title: "Trainer Sakonji Urokodaki",
            duration: "25 min",
            videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"
          }
        ]
      }
    ]
  },
  {
    id: "la-la-land",
    title: "La La Land",
    type: "movie",
    rating: 8.0,
    match: "90% Match",
    year: "2016",
    duration: "2h 8m",
    genres: ["Romance", "Drama", "Music"],
    description: "While navigating their careers in Los Angeles, a pianist and an actress fall in love while attempting to reconcile their aspirations for the future with their feelings for each other.",
    creator: "Damien Chazelle",
    cast: ["Ryan Gosling", "Emma Stone", "Amiée Conn", "Terry Walters"],
    bannerGradient: "linear-gradient(135deg, #182C4E 0%, #081120 100%)",
    accentColor: "#FF6B00",
    iconDoodle: "piano",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
  }
];

const tmdbIdsByCatalogId = {
  "stranger-things": 66732,
  "spider-man-spiderverse": 324857,
  wednesday: 119051,
  "dune-part-two": 693134,
  "rick-and-morty": 60625,
  "squid-game": 93405,
  "everything-everywhere": 545611,
  "knives-out": 546554,
  interstellar: 157336,
  arcane: 94605,
  "demon-slayer": 85937,
  "la-la-land": 313369
};

const tmdbImagePathsByCatalogId = {
  "stranger-things": {
    poster: "/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg",
    backdrop: "/56v2KjBlU4XaOv9rVYEQypROD7P.jpg"
  },
  "spider-man-spiderverse": {
    poster: "/iiZZdoQBEYBv6id8su7ImL0oCbD.jpg",
    backdrop: "/hlCq6Qh9GVtuNcGZF4mQYluaZix.jpg"
  },
  wednesday: {
    poster: "/9PFonBhy4cQy7Jz20NpMygczOkv.jpg",
    backdrop: "/iHSwvRVsRyxpX7FE7GbviaDvgGZ.jpg"
  },
  "dune-part-two": {
    poster: "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
    backdrop: "/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg"
  },
  "rick-and-morty": {
    poster: "/cvhNj9eoRBe5SxjCbQTkh05UP5K.jpg",
    backdrop: "/8kOWDBK6XlPUzckuHDo3wwVRFwt.jpg"
  },
  "squid-game": {
    poster: "/dDlEmu3EZ0Pgg93K2SVNLCjCSvE.jpg",
    backdrop: "/4WmuB4TcthRz4co4cc9y7mAKuS3.jpg"
  },
  "everything-everywhere": {
    poster: "/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg",
    backdrop: "/ss0Os3uWJfQAENILHZUdX8Tt1OC.jpg"
  },
  "knives-out": {
    poster: "/pThyQovXQrw2m0s9x82twj48Jq4.jpg",
    backdrop: "/4HWAQu28e2yaWrtupFPGFkdNU7V.jpg"
  },
  interstellar: {
    poster: "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    backdrop: "/rAiYTfKGqDCRIIqo664sY9XZIvQ.jpg"
  },
  arcane: {
    poster: "/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg",
    backdrop: "/rkB4LyZHo1NHXFEDHl9vSD9r1lI.jpg"
  },
  "demon-slayer": {
    poster: "/xUfRZu2mi8jH6SzQEJGP6tjBuYj.jpg",
    backdrop: "/iBAtBLqCMON3NPIjyQ1wdMbpTAk.jpg"
  },
  "la-la-land": {
    poster: "/uDO8zWDhfWwoFdKS4fzkUJt0Rf0.jpg",
    backdrop: "/nlPCdZlHtRNcF6C9hzUH4ebmV1w.jpg"
  }
};

const tmdbImageUrl = (path, size) => `https://image.tmdb.org/t/p/${size}${path}`;

const buildTmdbStreamId = (movie, seasonNumber, episodeNumber) => {
  const tmdbId = tmdbIdsByCatalogId[movie.id];
  if (movie.type === "series") {
    return `tmdb:${tmdbId}:${seasonNumber}:${episodeNumber}`;
  }
  return `tmdb:${tmdbId}`;
};

export const movies = catalog.map((movie) => {
  const tmdbId = tmdbIdsByCatalogId[movie.id];
  const tmdbMediaType = movie.type === "series" ? "tv" : "movie";
  const imagePaths = tmdbImagePathsByCatalogId[movie.id];

  return {
    ...movie,
    tmdbId,
    tmdbMediaType,
    posterUrl: tmdbImageUrl(imagePaths.poster, "w500"),
    backdropUrl: tmdbImageUrl(imagePaths.backdrop, "w1280"),
    streamType: movie.type,
    streamId: movie.type === "movie" ? buildTmdbStreamId(movie) : undefined,
    seasons: movie.seasons?.map((season) => ({
      ...season,
      episodes: season.episodes.map((episode) => ({
        ...episode,
        tmdbId,
        tmdbMediaType: "tv",
        streamType: "series",
        streamId: buildTmdbStreamId(movie, season.seasonNumber, episode.episodeNumber)
      }))
    }))
  };
});

export const genresList = ["All", "Action", "Sci-Fi", "Horror", "Drama", "Comedy", "Mystery", "Animation", "Thriller", "Romance", "Adventure"];

