---
title: "Luminary 1A, build 099"
author: MIT Instrumentation Laboratory
date: July 1969
form: code
languages: [en]
first_published: 1969
source: "Luminary 1A (LMY99 revision 001), the Lunar Module guidance software flown on Apollo 11; assembly listing of 14 July 1969, MIT Museum, transcribed by the Virtual AGC project"
transcription: "https://github.com/chrislgarry/Apollo-11/tree/911e5c0283c629c50cb97666f34065e8c07d71a5/Luminary099"
rights: public-domain-declared
rights_note: "Every file of the Virtual AGC transcription is headed Copyright: Public domain. Its maintainer, Ron Burkey, describes Project Apollo software as public domain to the best of his non-lawyer understanding, and thanks the people at Draper Laboratory (the former MIT Instrumentation Laboratory) and NASA who allowed the transcription. No one has claimed rights in it since. Admitted by the author's delegate on 2026-09-26; see README.md, Judgement calls"
---

# Luminary 1A, build 099

```agc
# BURN, BABY, BURN -- MASTER IGNITION ROUTINE

		BANK	36
		SETLOC	P40S
		BANK
		EBANK=	WHICH
		COUNT*	$$/P40

# THE MASTER IGNITION ROUTINE IS DESIGNED FOR USE BY THE FOLLOWING LEM PROGRAMS:  P12, P40, P42, P61, P63.
# IT PERFORMS ALL FUNCTIONS IMMEDIATELY ASSOCIATED WITH APS OR DPS IGNITION:  IN PARTICULAR, EVERYTHING LYING
# BETWEEN THE PRE-IGNITION TIME CHECK -- ARE WE WITHIN 45 SECONDS OF TIG? -- AND TIG + 26 SECONDS, WHEN DPS
# PROGRAMS THROTTLE UP.
```

⋮

```agc
# THE FOLLOWING QUOTATION IS PROVIDED THROUGH THE COURTESY OF THE AUTHORS.
#
#	::IT WILL BE PROVED TO THY FACE THAT THOU HAST MEN ABOUT THEE THAT
# USUALLY TALK OF A NOUN AND A VERB, AND SUCH ABOMINABLE WORDS AS NO
# CHRISTIAN EAR CAN ENDURE TO HEAR.::
#					HENRY 6, ACT 2, SCENE 4
```

⋮

```agc
		CAF	TWO		# WCHPHASE = 2 ---> VERTICAL: P65,P66,P67
		TS	WCHPHOLD
		TS	WCHPHASE
		TC	BANKCALL	# TEMPORARY, I HOPE HOPE HOPE
		CADR	STOPRATE	# TEMPORARY, I HOPE HOPE HOPE
		TC	DOWNFLAG	# PERMIT X-AXIS OVERRIDE
```

---

The Apollo Guidance Computer software that landed the Lunar Module *Eagle* on 20 July 1969, written at the MIT Instrumentation Laboratory by a team led by Margaret Hamilton. Three excerpts from the assembly listing of 14 July 1969 (Luminary 1A, build 099), as transcribed by Ron Burkey's Virtual AGC project from printouts scanned at the MIT Museum: the head of the master ignition routine, which Don Eyles and Peter Adler named after the disc jockey Magnificent Montague's cry "Burn, baby! Burn!"; a quotation from *Henry VI, Part 2* that the authors left in the display code, where the software talks to its astronauts in verbs and nouns (the line is in fact Act IV, Scene 7); and two lines of the landing guidance marked, with some feeling, as temporary. They flew. The transcribers' page markers are left out; tabs are as in the transcription.
