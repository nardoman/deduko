DEDUKO.addPack({
 "format": 1,
 "id": "core",
 "version": [
  1,
  0,
  0
 ],
 "cases": [
  {
   "id": "c1",
   "difficulty": 1,
   "categories": [
    {
     "id": "suspect",
     "items": [
      "anna",
      "bruno",
      "carla",
      "dario"
     ]
    },
    {
     "id": "weapon",
     "items": [
      "knife",
      "rope",
      "candlestick",
      "pistol"
     ]
    },
    {
     "id": "room",
     "items": [
      "library",
      "kitchen",
      "garden",
      "cellar"
     ]
    }
   ],
   "solution": [
    [
     "anna",
     "candlestick",
     "kitchen"
    ],
    [
     "bruno",
     "pistol",
     "cellar"
    ],
    [
     "carla",
     "rope",
     "garden"
    ],
    [
     "dario",
     "knife",
     "library"
    ]
   ],
   "clues": [
    {
     "t": "pair",
     "a": "suspect.carla",
     "b": "suspect.anna",
     "c": "weapon.candlestick",
     "d": "weapon.rope"
    },
    {
     "t": "or",
     "a": "weapon.knife",
     "b": "suspect.carla",
     "c": "suspect.dario"
    },
    {
     "t": "is",
     "a": "room.cellar",
     "b": "weapon.pistol"
    },
    {
     "t": "not",
     "a": "room.garden",
     "b": "suspect.anna"
    },
    {
     "t": "not",
     "a": "weapon.candlestick",
     "b": "suspect.carla"
    },
    {
     "t": "or",
     "a": "room.library",
     "b": "weapon.knife",
     "c": "weapon.pistol"
    }
   ],
   "gen": {
    "engine": 1,
    "seed": 11
   }
  },
  {
   "id": "c2",
   "difficulty": 2,
   "categories": [
    {
     "id": "suspect",
     "items": [
      "anna",
      "bruno",
      "carla",
      "dario",
      "elena"
     ]
    },
    {
     "id": "weapon",
     "items": [
      "knife",
      "rope",
      "candlestick",
      "pistol",
      "poison"
     ]
    },
    {
     "id": "room",
     "items": [
      "library",
      "kitchen",
      "garden",
      "cellar",
      "study"
     ]
    }
   ],
   "solution": [
    [
     "anna",
     "candlestick",
     "garden"
    ],
    [
     "bruno",
     "poison",
     "kitchen"
    ],
    [
     "carla",
     "rope",
     "library"
    ],
    [
     "dario",
     "pistol",
     "study"
    ],
    [
     "elena",
     "knife",
     "cellar"
    ]
   ],
   "clues": [
    {
     "t": "pair",
     "a": "room.garden",
     "b": "room.study",
     "c": "suspect.anna",
     "d": "suspect.dario"
    },
    {
     "t": "pair",
     "a": "weapon.pistol",
     "b": "weapon.candlestick",
     "c": "suspect.dario",
     "d": "suspect.anna"
    },
    {
     "t": "pair",
     "a": "room.garden",
     "b": "room.cellar",
     "c": "weapon.candlestick",
     "d": "weapon.knife"
    },
    {
     "t": "or",
     "a": "room.garden",
     "b": "suspect.anna",
     "c": "suspect.carla"
    },
    {
     "t": "is",
     "a": "weapon.rope",
     "b": "suspect.carla"
    },
    {
     "t": "or",
     "a": "suspect.bruno",
     "b": "room.study",
     "c": "room.kitchen"
    }
   ],
   "gen": {
    "engine": 1,
    "seed": 22
   }
  },
  {
   "id": "c3",
   "difficulty": 3,
   "categories": [
    {
     "id": "suspect",
     "items": [
      "conte",
      "cuoca",
      "fabio",
      "giulia"
     ]
    },
    {
     "id": "weapon",
     "items": [
      "knife",
      "rope",
      "poison",
      "wrench"
     ]
    },
    {
     "id": "motive",
     "items": [
      "money",
      "jealousy",
      "revenge",
      "blackmail"
     ]
    },
    {
     "id": "time",
     "ordered": true,
     "items": [
      "h20",
      "h21",
      "h22",
      "h23"
     ]
    }
   ],
   "solution": [
    [
     "conte",
     "wrench",
     "revenge",
     "h23"
    ],
    [
     "cuoca",
     "poison",
     "blackmail",
     "h20"
    ],
    [
     "fabio",
     "rope",
     "jealousy",
     "h21"
    ],
    [
     "giulia",
     "knife",
     "money",
     "h22"
    ]
   ],
   "clues": [
    {
     "t": "not",
     "a": "time.h20",
     "b": "suspect.fabio"
    },
    {
     "t": "is",
     "a": "motive.blackmail",
     "b": "time.h20"
    },
    {
     "t": "less",
     "a": "weapon.knife",
     "b": "suspect.conte",
     "by": "time"
    },
    {
     "t": "or",
     "a": "motive.revenge",
     "b": "suspect.cuoca",
     "c": "suspect.conte"
    },
    {
     "t": "pair",
     "a": "weapon.rope",
     "b": "weapon.wrench",
     "c": "suspect.conte",
     "d": "suspect.fabio"
    },
    {
     "t": "less",
     "a": "suspect.fabio",
     "b": "weapon.wrench",
     "by": "time"
    },
    {
     "t": "not",
     "a": "suspect.giulia",
     "b": "time.h21"
    },
    {
     "t": "is",
     "a": "weapon.knife",
     "b": "motive.money"
    },
    {
     "t": "less",
     "a": "weapon.poison",
     "b": "suspect.giulia",
     "by": "time"
    }
   ],
   "gen": {
    "engine": 1,
    "seed": 33
   }
  },
  {
   "id": "c4",
   "difficulty": 4,
   "categories": [
    {
     "id": "suspect",
     "items": [
      "anna",
      "bruno",
      "elena",
      "conte",
      "cuoca"
     ]
    },
    {
     "id": "room",
     "items": [
      "library",
      "kitchen",
      "garden",
      "cellar",
      "ballroom"
     ]
    },
    {
     "id": "motive",
     "items": [
      "money",
      "jealousy",
      "revenge",
      "fear",
      "inheritance"
     ]
    },
    {
     "id": "time",
     "ordered": true,
     "items": [
      "h19",
      "h20",
      "h21",
      "h22",
      "h23"
     ]
    }
   ],
   "solution": [
    [
     "anna",
     "kitchen",
     "fear",
     "h22"
    ],
    [
     "bruno",
     "garden",
     "jealousy",
     "h20"
    ],
    [
     "elena",
     "ballroom",
     "money",
     "h21"
    ],
    [
     "conte",
     "cellar",
     "inheritance",
     "h19"
    ],
    [
     "cuoca",
     "library",
     "revenge",
     "h23"
    ]
   ],
   "clues": [
    {
     "t": "pair",
     "a": "motive.fear",
     "b": "motive.inheritance",
     "c": "suspect.anna",
     "d": "suspect.conte"
    },
    {
     "t": "or",
     "a": "room.library",
     "b": "time.h21",
     "c": "time.h23"
    },
    {
     "t": "or",
     "a": "room.cellar",
     "b": "time.h20",
     "c": "time.h19"
    },
    {
     "t": "is",
     "a": "room.ballroom",
     "b": "time.h21"
    },
    {
     "t": "less",
     "a": "suspect.bruno",
     "b": "suspect.anna",
     "by": "time"
    },
    {
     "t": "is",
     "a": "motive.money",
     "b": "room.ballroom"
    },
    {
     "t": "or",
     "a": "motive.jealousy",
     "b": "room.garden",
     "c": "room.ballroom"
    },
    {
     "t": "not",
     "a": "motive.inheritance",
     "b": "suspect.anna"
    },
    {
     "t": "pair",
     "a": "suspect.cuoca",
     "b": "suspect.bruno",
     "c": "time.h20",
     "d": "time.h23"
    }
   ],
   "gen": {
    "engine": 1,
    "seed": 44
   }
  },
  {
   "id": "c5",
   "difficulty": 5,
   "categories": [
    {
     "id": "suspect",
     "items": [
      "bruno",
      "carla",
      "elena",
      "giulia",
      "cuoca"
     ]
    },
    {
     "id": "weapon",
     "items": [
      "knife",
      "rope",
      "candlestick",
      "pistol",
      "poison"
     ]
    },
    {
     "id": "room",
     "items": [
      "library",
      "kitchen",
      "study",
      "cellar",
      "ballroom"
     ]
    },
    {
     "id": "motive",
     "items": [
      "money",
      "jealousy",
      "revenge",
      "blackmail",
      "inheritance"
     ]
    },
    {
     "id": "time",
     "ordered": true,
     "items": [
      "h19",
      "h20",
      "h21",
      "h22",
      "h23"
     ]
    }
   ],
   "solution": [
    [
     "bruno",
     "candlestick",
     "study",
     "revenge",
     "h20"
    ],
    [
     "carla",
     "pistol",
     "cellar",
     "blackmail",
     "h19"
    ],
    [
     "elena",
     "rope",
     "ballroom",
     "money",
     "h21"
    ],
    [
     "giulia",
     "poison",
     "library",
     "inheritance",
     "h23"
    ],
    [
     "cuoca",
     "knife",
     "kitchen",
     "jealousy",
     "h22"
    ]
   ],
   "clues": [
    {
     "t": "pair",
     "a": "motive.inheritance",
     "b": "motive.revenge",
     "c": "time.h23",
     "d": "time.h20"
    },
    {
     "t": "pair",
     "a": "weapon.knife",
     "b": "weapon.poison",
     "c": "suspect.giulia",
     "d": "suspect.cuoca"
    },
    {
     "t": "less",
     "a": "room.study",
     "b": "suspect.cuoca",
     "by": "time"
    },
    {
     "t": "less",
     "a": "suspect.bruno",
     "b": "motive.money",
     "by": "time"
    },
    {
     "t": "pair",
     "a": "motive.revenge",
     "b": "motive.blackmail",
     "c": "suspect.bruno",
     "d": "suspect.carla"
    },
    {
     "t": "or",
     "a": "suspect.elena",
     "b": "weapon.rope",
     "c": "weapon.poison"
    },
    {
     "t": "is",
     "a": "suspect.cuoca",
     "b": "time.h22"
    },
    {
     "t": "not",
     "a": "suspect.carla",
     "b": "time.h20"
    },
    {
     "t": "is",
     "a": "motive.jealousy",
     "b": "time.h22"
    },
    {
     "t": "less",
     "a": "weapon.knife",
     "b": "suspect.giulia",
     "by": "time"
    },
    {
     "t": "pair",
     "a": "room.library",
     "b": "room.ballroom",
     "c": "time.h21",
     "d": "time.h23"
    },
    {
     "t": "not",
     "a": "suspect.bruno",
     "b": "weapon.pistol"
    },
    {
     "t": "pair",
     "a": "room.cellar",
     "b": "room.ballroom",
     "c": "suspect.elena",
     "d": "suspect.carla"
    }
   ],
   "gen": {
    "engine": 1,
    "seed": 55
   }
  }
 ],
 "settings": [
  {
   "id": "manor",
   "code": 1,
   "categories": [
    {
     "id": "suspect",
     "items": [
      "anna",
      "bruno",
      "carla",
      "dario",
      "conte",
      "cuoca"
     ]
    },
    {
     "id": "weapon",
     "items": [
      "knife",
      "rope",
      "candlestick",
      "pistol",
      "poison",
      "wrench"
     ]
    },
    {
     "id": "room",
     "items": [
      "library",
      "kitchen",
      "garden",
      "cellar",
      "study",
      "ballroom"
     ]
    },
    {
     "id": "motive",
     "items": [
      "money",
      "jealousy",
      "revenge",
      "fear",
      "blackmail",
      "inheritance"
     ]
    },
    {
     "id": "time",
     "ordered": true,
     "items": [
      "h18",
      "h19",
      "h20",
      "h21",
      "h22",
      "h23"
     ]
    }
   ]
  }
 ]
});
