# Data

Bwenge.space uses public datasets and reports from the **National Institute of Statistics of Rwanda (NISR)**.

| Source | Link |
|---|---|
| NISR microdata portal | https://microdata.statistics.gov.rw/index.php/catalog |
| NISR publications and statistics | https://www.statistics.gov.rw |

The files are large, so they are **not stored in this repository**. They are downloaded from the links above and
uploaded to the platform (admin dataset repositories), where every file is indexed and, once published, offered to
all users in the **Public library** and to the AI. Answers cite the file, page or sheet they came from.

```
data/
  README.md      this file
  nisr/          manifest, schemas and generated index for NISR sources (see nisr/README.md)
```

How a dataset is added, described and checked: [`nisr/README.md`](nisr/README.md).
Survey responses collected with Bwenge forms and exam scripts uploaded by teachers are private user data and are
never stored in this repository.
