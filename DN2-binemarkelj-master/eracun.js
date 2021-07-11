// Za združljivost razvoja na lokalnem računalniku ali AWS Cloud9 okolju
if (!process.env.PORT) {
  process.env.PORT = 8080;
}

// Priprava povezave na podatkovno bazo
const sqlite3 = require("sqlite3").verbose();
const pb = new sqlite3.Database("Chinook.sl3");

// Priprava dodatnih knjižnic
const formidable = require("formidable");

// Priprava strežnika
const express = require("express");
const streznik = express();
streznik.set("view engine", "hbs");
streznik.use(express.static("public"));

// Podpora sejam na strežniku
const expressSession = require("express-session");
streznik.use(
  expressSession({
    secret: "123456789QWERTY",    // Skrivni ključ za podpisovanje piškotov
    saveUninitialized: true,      // Novo sejo shranimo
    resave: false,                // Ne zahtevamo ponovnega shranjevanja
    cookie: {
      maxAge: 3600000             // Seja poteče po 1 h neaktivnosti
    }
  })
);

const razmerje_USD_EUR = 0.93;
const drzaveEU = [
  "Germany", "Norway", "Czech Republic", "Austria", "Belgium", "Denmark",
  "Portugal", "France", "Finland", "Hungary", "Italy", "Netherlands",
  "Poland", "Spain", "Sweden", "Slovenija"
];

// Izračun davčne stopnje glede na izvajalca in žanr
function davcnaStopnja(izvajalec, zanr) {
  switch (izvajalec) {
    case "Queen": case "Led Zeppelin": case "Kiss":
      return 0;
    case "Justin Bieber": case "Incognito":
      return 22;
    default:
      break;
  }
  switch (zanr) {
    case "Metal": case "Heavy Metal": case "Easy Listening":
      return 0;
    default:
      return 9.5;
  }
}

// Vrne naziv stranke (ime in priimek) glede na ID stranke
const vrniNazivStranke = function(strankaId, povratniKlic) {
  pb.all(
    "SELECT Customer.FirstName || ' ' || Customer.LastName AS naziv \
     FROM   Customer \
     WHERE  Customer.CustomerId = $id",
     { $id: strankaId },
     function (napaka, vrstica) {
       if (napaka) {
         povratniKlic("");
       } else {
         povratniKlic(vrstica.length > 0 ? vrstica[0].naziv : "");
       }
     }
  );
};

// Prikaz seznama pesmi na strani
streznik.get("/", function(zahteva, odgovor) {
  
  if (zahteva.session.trenutnaStranka == undefined) {
    odgovor.redirect("/prijava");
  } else {
  
  pb.all(
    "SELECT   Track.TrackId AS id, \
              Track.Name AS pesem, \
              Artist.Name AS izvajalec, \
              ROUND(Track.UnitPrice * " + razmerje_USD_EUR + ", 2) AS cena, \
              COUNT(InvoiceLine.InvoiceId) AS steviloProdaj, \
              Genre.Name AS zanr \
     FROM     Track, Album, Artist, InvoiceLine, Genre \
     WHERE    Track.AlbumId = Album.AlbumId AND \
              Artist.ArtistId = Album.ArtistId AND \
              InvoiceLine.TrackId = Track.TrackId AND \
              Track.GenreId = Genre.GenreId \
     GROUP BY Track.TrackId \
     ORDER BY steviloProdaj DESC, pesem ASC \
     LIMIT    100",
    function(napaka, vrstice) {
      if (napaka) {
        odgovor.sendStatus(500);
      } else {
        let zanri = new Set();
        for (let i=0; i < vrstice.length; i++) {
          vrstice[i].stopnja = davcnaStopnja(
            vrstice[i].izvajalec,
            vrstice[i].zanr
          );
          vrstice[i].cena = (vrstice[i].cena * (1 + vrstice[i].stopnja/100)).toFixed(2);
          zanri.add(vrstice[i].zanr);
        }
        vrniNazivStranke(
          zahteva.session.trenutnaStranka,
          function(nazivOdgovor) {
            odgovor.render("seznam", {
              podnaslov: "Nakupovalni seznam",
              prijavniGumb: "Odjava",
              seznamPesmi: vrstice,
              nazivStranke: nazivOdgovor
            });
          }
        );
      }
    }
  );
}});

// Dodajanje oz. brisanje pesmi iz košarice
streznik.get("/kosarica/:idPesmi", function(zahteva, odgovor) {
  let idPesmi = parseInt(zahteva.params.idPesmi, 10);
  if (!zahteva.session.kosarica) {
    zahteva.session.kosarica = [];
  }
  if (zahteva.session.kosarica.indexOf(idPesmi) > -1) {
    // Če je pesem v košarici, jo izbrišemo
    zahteva.session.kosarica.splice(zahteva.session.kosarica.indexOf(idPesmi), 1);
  } else {
    // Če pesmi ni v košarici, jo dodamo
    zahteva.session.kosarica.push(idPesmi);
  }
  // V odgovoru vrnemo vsebino celotne košarice
  odgovor.send(zahteva.session.kosarica);
});

// Vrni podrobnosti pesmi v košarici iz podatkovne baze
const pesmiIzKosarice = function(zahteva, povratniKlic) {
  // Če je košarica prazna
  if (!zahteva.session.kosarica || zahteva.session.kosarica.length == 0) {
    povratniKlic([]);
  } else {
    pb.all(
      "SELECT Track.TrackId AS stevilkaArtikla, \
              1 AS kolicina, \
              Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
              ROUND(Track.UnitPrice * " + razmerje_USD_EUR + ", 2) AS cena, \
              Genre.Name AS zanr, \
              0 AS popust \
       FROM   Track, Album, Artist, Genre \
       WHERE  Track.AlbumId = Album.AlbumId AND \
              Artist.ArtistId = Album.ArtistId AND \
              Track.GenreId = Genre.GenreId AND \
              Track.TrackId IN (" + zahteva.session.kosarica.join(",") + ")",
      function(napaka, vrstice) {
        if (napaka) {
          povratniKlic(false);
        } else {
          for (let i=0; i < vrstice.length; i++) {
            vrstice[i].stopnja = davcnaStopnja(
              (vrstice[i].opisArtikla.split(" (")[1]).split(")")[0],
              vrstice[i].zanr
            );
          }
          povratniKlic(vrstice);
        }
      }
    );
  }
};

streznik.get("/kosarica", function(zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi)
      odgovor.sendStatus(500);
    else
      odgovor.send(pesmi);
  });
});

// Vrni podrobnosti pesmi na računu
const pesmiIzRacuna = function(racunId, povratniKlic) {
  pb.all(
    "SELECT Track.TrackId AS stevilkaArtikla, \
            1 AS kolicina, \
            Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
            Track.UnitPrice * " + razmerje_USD_EUR + " AS cena, \
            0 AS popust, \
            Genre.Name AS zanr \
     FROM   Track, Album, Artist, Genre \
     WHERE  Track.AlbumId = Album.AlbumId AND \
            Artist.ArtistId = Album.ArtistId AND \
            Track.GenreId = Genre.GenreId AND \
            Track.TrackId IN ( \
              SELECT  InvoiceLine.TrackId \
              FROM    InvoiceLine, Invoice \
              WHERE   InvoiceLine.InvoiceId = Invoice.InvoiceId AND \
                      Invoice.InvoiceId = $id \
            )",
    { $id: racunId },
    function(napaka, vrstice) {
      if (napaka) {
        povratniKlic(false);
      } else {
        povratniKlic(napaka, vrstice);
      }
    }
  );
};

// Vrni podrobnosti o stranki iz računa
const strankaIzRacuna = function(racunId, povratniKlic) {
  pb.all(
    "SELECT Customer.* \
     FROM   Customer, Invoice \
     WHERE  Customer.CustomerId = Invoice.CustomerId AND \
            Invoice.InvoiceId = $id",
    { $id: racunId },
    function(napaka, vrstice) {
      console.log(vrstice);
      povratniKlic(vrstice);
    }
  );
};

// Izpis račun v HTML predstavitvi na podlagi podatkov iz baze
streznik.post("/izpisiRacunBaza", function(zahteva, odgovor) {
  let form = new formidable.IncomingForm();
  form.parse(zahteva, function (napaka, polja, datoteke) {
    var racunId = parseInt(polja["seznamRacunov"], 10);
    strankaIzRacuna(racunId, function (stranka) {
      pesmiIzRacuna(racunId, function (napaka, pesmi) {
        let povzetek = {
          vsotaSPopustiInDavki: 0,
          vsoteZneskovDdv: { "0": 0, "9.5": 0, "22": 0 },
          vsoteOsnovZaDdv: { "0": 0, "9.5": 0, "22": 0 },
          vsotaVrednosti: 0,
          vsotaPopustov: 0
        };
        pesmi.forEach(function(pesem, i) {
          pesem.zapSt = i + 1;
          pesem.vrednost = pesem.kolicina * pesem.cena;
          pesem.stopnja = davcnaStopnja(pesem, pesem.zanr);
          console.log(davcnaStopnja(pesem, pesem.zanr));
          pesem.davcnaStopnja = pesem.stopnja;
          pesem.popustStopnja = pesem.popust;
          pesem.popust = pesem.kolicina * pesem.cena * (pesem.popustStopnja/100);
          pesem.osnovaZaDdv = pesem.vrednost - pesem.popust;
          pesem.ddv = pesem.osnovaZaDdv * (pesem.davcnaStopnja/100);
          pesem.osnovaZaDdvInDdv = pesem.osnovaZaDdv + pesem.ddv;

          povzetek.vsotaSPopustiInDavki += (pesem.osnovaZaDdv + pesem.ddv);
          povzetek.vsoteZneskovDdv["" + pesem.davcnaStopnja] += pesem.ddv;
          povzetek.vsoteOsnovZaDdv["" + pesem.davcnaStopnja] += pesem.osnovaZaDdv;
          povzetek.vsotaVrednosti += pesem.vrednost;
          povzetek.vsotaPopustov += pesem.popust;
        });
        odgovor.setHeader("Content-Type", "text/xml");
        odgovor.render(
          "eslog",
          {
            vizualiziraj: true,
            postavkeRacuna: pesmi,
            povzetekRacuna: povzetek,
            stranka: stranka[0],
            layout: null
          }
        );
      });
    });
  });
});


const strankaIzBaze = function (strankaId, povratniKlic) {
  pb.get(
    "SELECT Customer.* \
     FROM   Customer \
     WHERE  Customer.CustomerId = $cid",
    { $cid: strankaId },
    function (napaka, vrstica) {
      povratniKlic(vrstica);
      console.log(vrstica);
    }
  );
};

// Izpis računa v HTML predstavitvi ali izvorni XML obliki
streznik.get("/izpisiRacun/:oblika", function(zahteva, odgovor) {
  strankaIzBaze(zahteva.session.trenutnaStranka, function(stranka) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi) {
      odgovor.sendStatus(500);
    } else if (pesmi.length == 0) {
      odgovor.send(
        "<p>V košarici nimate nobene pesmi, \
         zato računa ni mogoče pripraviti!</p>"
      );
    } else {
      let zanri = {};
      let steviloPesmi = 0;
      for (let i=0; i < pesmi.length; i++) {
        // Število pesmi po žanrih
        if (pesmi[i].zanr in zanri) {
          zanri[pesmi[i].zanr]++;
        } else {
          zanri[pesmi[i].zanr] = 1;
        }
        // Število pesmi izbranih izvajalcev
        if (pesmi[i].opisArtikla.endsWith("(Iron Maiden)") ||
            pesmi[i].opisArtikla.endsWith("(Body Count)")) {
          steviloPesmi++;
        }
      }
      var steviloZanrov = 0;
      let skupniPopust =
        (pesmi.length >= 5 ? 20 : 0) +              // +20 % za več kot 5 pesmi
        (steviloPesmi > 1 ? 5 : 0) +                // +5 % za več pesmi izbranih izvajalcev
        (new Date().getMinutes() <= 30 ? 1 : 0);    // +1 % za prvo polovico ure
      // Nakup več pesmi istega žanra
      for (let zanr in zanri) {
        
        if (zanri[zanr] >= 3) {
          steviloZanrov++;
          switch (steviloZanrov) {                         //prištevanje popustov ob več pesmih istega žanra
            case 1:                                        //zgleda malo čudno ampak dela:)
              skupniPopust = skupniPopust + (3 + 10);
              break;
            
            case 2: 
              skupniPopust = skupniPopust + (7 + 10 -13);
              break;
            
            case 3: 
              skupniPopust = skupniPopust + (13 + 10 - 17);
              break;
           
            default:
              skupniPopust = skupniPopust + 0;
              break;
          }
        }
      }
      

      let povzetek = {
        vsotaSPopustiInDavki: 0,
        vsoteZneskovDdv: { "0": 0, "9.5": 0, "22": 0 },
        vsoteOsnovZaDdv: { "0": 0, "9.5": 0, "22": 0 },
        vsotaVrednosti: 0,
        vsotaPopustov: 0
      };
      pesmi.forEach(function(pesem, i) {
        pesem.zapSt = i + 1;
        pesem.vrednost = pesem.kolicina * pesem.cena;
        pesem.davcnaStopnja = pesem.stopnja;
        pesem.popustStopnja = pesem.popust + skupniPopust;
        pesem.popust = pesem.kolicina * pesem.cena * (pesem.popustStopnja/100);
        pesem.osnovaZaDdv = pesem.vrednost - pesem.popust;
        pesem.ddv = pesem.osnovaZaDdv * (pesem.davcnaStopnja/100);
        pesem.osnovaZaDdvInDdv = pesem.osnovaZaDdv + pesem.ddv;

        povzetek.vsotaSPopustiInDavki += (pesem.osnovaZaDdv + pesem.ddv);
        povzetek.vsoteZneskovDdv["" + pesem.davcnaStopnja] += pesem.ddv;
        povzetek.vsoteOsnovZaDdv["" + pesem.davcnaStopnja] += pesem.osnovaZaDdv;
        povzetek.vsotaVrednosti += pesem.vrednost;
        povzetek.vsotaPopustov += pesem.popust;
      });

      
      

      odgovor.setHeader("Content-Type", "text/xml");
      odgovor.render(
        "eslog",
        {
          vizualiziraj: zahteva.params.oblika == "html",
          postavkeRacuna: pesmi,
          povzetekRacuna: povzetek,
          layout: null,
          stranka: stranka
        }
      );

    }
  });
});
});

// Privzeto izpiši račun v HTML obliki
streznik.get("/izpisiRacun", function(zahteva, odgovor) {
  odgovor.redirect("/izpisiRacun/html");
});

//metoda za preverjanje, če je stranka iz EU

function jeZnotrajEU(drzava) {
  
  if (drzaveEU.includes(drzava)) {
    return true;
  } else {
    return false;
  }
}

// Vrni stranke iz podatkovne baze
const vrniStranke = function(povratniKlic) {
  pb.all(
    "SELECT * FROM Customer",
    function(napaka, vrstice) {
      for (var stevec = 0; stevec < vrstice.length; stevec++) {
        var vEU;
        
        if (jeZnotrajEU(vrstice[stevec].Country)) {
          vrstice[stevec].vEU = "(EU)";
        } else {
          vrstice[stevec].vEU = "";
        }
      }
      povratniKlic(napaka, vrstice);
    }
  );
};

// Vrni račune iz podatkovne baze
const vrniRacune = function(povratniKlic) {
  pb.all(
    "SELECT Customer.FirstName || ' ' || Customer.LastName || \
            ' (' || Invoice.InvoiceId || ') - ' || \
            DATE(Invoice.InvoiceDate) AS Naziv, \
            Invoice.InvoiceId \
     FROM   Customer, Invoice \
     WHERE  Customer.CustomerId = Invoice.CustomerId",
    function(napaka, vrstice) {
      povratniKlic(napaka, vrstice);
    }
  );
};

// Registracija novega uporabnika
streznik.post("/prijava", function(zahteva, odgovor) {
  let form = new formidable.IncomingForm();
  let sporociloNapaka = "Prišlo je do napake pri dodajanju nove stranke. Prosim, preverite vnesene podatke in poskusite znova.";
  
  var praznoPolje = true;
  var afna = "@";
  var supportRepId = 12;
  
  
  form.parse(zahteva, function(napaka, polja, datoteke) {
    let sporociloOK = "Nova stranka" + " " + polja.FirstName + " " + polja.LastName + " " +"je bila uspešno dodana.";
   
   if ((polja.FirstName !="") && (polja.LastName != "") && (polja.Company != "") && (polja.Address != "") && (polja.State != "") && (polja.PostalCode != "") && (polja.City != "") && (polja.Country != "") && (polja.Phone != "") && (polja.Fax != "") && (polja.Email.includes(afna))) {
     praznoPolje = false;
  }
  
  var firstName = polja.FirstName;
  var lastName = polja.LastName;
  var company = polja.Company;
  var address = polja.Address;
  var state = polja.State;
  var postalCode = polja.PostalCode;
  var city = polja.City;
  var country = polja.Country;
  var phone = polja.Phone;
  var fax = polja.Fax;
  var email = polja.Email;
   
    if (praznoPolje == true) {
      vrniStranke(function(napaka1, stranke) {
        vrniRacune(function(napaka2, racuni) {
          odgovor.render(
            "prijava",
            {
              prijavniGumb: "Prijava stranke",
              sporocilo: sporociloNapaka,
              seznamStrank: stranke,
              seznamRacunov: racuni
            }
          );
        });
      });
    } else {
      pb.run(
        "INSERT INTO Customer (FirstName, LastName, Company, \
                               Address, City, State, Country, PostalCode, \
                               Phone, Fax, Email, SupportRepId) \
         VALUES ($fn, $ln, $com, $addr, $city, $state, $country, $pc, $phone, \
                 $fax, $email, $sri)",
        {
        $fn: polja.FirstName,
        $ln: polja.LastName,
        $addr: polja.Address, 
        $city: polja.City,
        $state: polja.State,
        $country: polja.Country,
        $pc: polja.PostalCode,
        $phone: polja.Phone,
        $fax: polja.Fax,
        $email: polja.Email,
        $sri: supportRepId,
        },
        function(napaka) {
          vrniStranke(function(napaka1, stranke) {
            vrniRacune(function(napaka2, racuni) {
              odgovor.render(
                "prijava",
                {
                  prijavniGumb: "Prijava stranke",
                  sporocilo: napaka ? sporociloNapaka : sporociloOK,
                  seznamStrank: stranke,
                  seznamRacunov: racuni
                }
              );
            });
          });
        }
      );
    }
  });
});

const prestejRacuneZaStranko = function(stranka, racuni) {
  let stevec = 0;
  for (let i=0; i < racuni.length; i++) {
    if (racuni[i].Naziv.startsWith(stranka.FirstName + " " + stranka.LastName)) {
      stevec++;
    }
  }
  return stevec;
};

// Prikaz strani za prijavo
streznik.get("/prijava", function(zahteva, odgovor) {
  vrniStranke(function(napaka1, stranke) {
    vrniRacune(function(napaka2, racuni) {
      for (let i=0; i < stranke.length; i++) {
        stranke[i].stRacunov = prestejRacuneZaStranko(stranke[i], racuni);
      }
      odgovor.render(
        "prijava",
        {
          sporocilo: "",
          prijavniGumb: "Prijava stranke",
          podnaslov: "Prijavna stran",
          seznamStrank: stranke,
          seznamRacunov: racuni
        }
      );
    });
  });
});

// Prikaz nakupovalne košarice za stranko
streznik.post("/stranka", function(zahteva, odgovor) {
  let form = new formidable.IncomingForm();
  form.parse(zahteva, function(napaka1, polja, datoteke) {
    zahteva.session.trenutnaStranka = parseInt(polja["seznamStrank"], 10);
    odgovor.redirect("/");
  });
});

// Prijava ali odjava stranke
streznik.get("/prijavaOdjava/:strankaId", function(zahteva, odgovor) {
  if (zahteva.get("referer").endsWith("/prijava")) {
    // Izbira stranke oz. prijava
    zahteva.session.trenutnaStranka = parseInt(zahteva.params.strankaId, 10);
    odgovor.redirect("/");
  } else {
    // Odjava stranke
    delete zahteva.session.trenutnaStranka;
    delete zahteva.session.kosarica;
    odgovor.redirect("/prijava");
  }
});

// Prikaz seznama pesmi na strani
streznik.get("/seznam-izvajalcev", function (zahteva, odgovor) {
  pb.all(
    "SELECT Track.TrackId AS id, \
            Track.Name AS pesem, \
            Artist.Name AS izvajalec, \
            COUNT(InvoiceLine.InvoiceId) AS steviloProdaj \
     FROM   Track, Album, Artist, InvoiceLine \
     WHERE  Track.AlbumId = Album.AlbumId AND \
            Artist.ArtistId = Album.ArtistId AND \
            InvoiceLine.TrackId = Track.TrackId \
     GROUP BY Track.TrackId \
     ORDER BY steviloProdaj DESC, pesem ASC \
     LIMIT  100",
  function (napaka, vrstice) {
    if (napaka) {
      odgovor.sendStatus(500);
    } else {
      let izvajalci = {};
      
      for (var stevec = 0; stevec < vrstice.length; stevec++) {
        izvajalci[vrstice[stevec].izvajalec] = 0;
      }
      for (var stevec = 0; stevec < vrstice.length; stevec++) {
        izvajalci[vrstice[stevec].izvajalec] = izvajalci[vrstice[stevec].izvajalec] + ((vrstice[stevec].steviloProdaj)/2);
      }
      console.log(izvajalci);
      
      odgovor.send(izvajalci);
    }
  });
});

streznik.get("/podrobnosti", function (zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function (pesmi) {
    let zanri = {}
        
        for (var stevec = 0; stevec < pesmi.length; stevec++) {
          zanri[pesmi[stevec].zanr] = 0;
        }
          
          for (var stevec = 0; stevec < pesmi.length; stevec++) {
          zanri[pesmi[stevec].zanr]++;
          console.log(zanri[pesmi[stevec].zanr]);
      
    }
    
    console.log(zanri);
    odgovor.send(zanri);
  });
});

streznik.listen(process.env.PORT, function() {
  console.log("Strežnik je pognan!");
});

//nova metoda za število pesmi računa in ceno
streznik.get("/podrobnosti-racuna/:racunId", function(zahteva, odgovor) {
 
  var racunId = zahteva.params.racunId; 
  pesmiIzRacuna(racunId, function(napaka, pesmi) {
    var steviloPesmi = 0;
    var cenaPesmi = 0;
    
    for (var stevec = 0; stevec < pesmi.length; stevec++) {
      steviloPesmi++;
      cenaPesmi = cenaPesmi + pesmi[stevec].cena;
    }
    
    var skupnaCena= cenaPesmi.toFixed(2);
    var stPesmi = steviloPesmi;
    
    odgovor.send({stPesmi, skupnaCena});
  });
});