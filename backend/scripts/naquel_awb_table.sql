-- Create Naquel_awb table
CREATE TABLE `Naquel_awb` (
  `Id` mediumint(9) NOT NULL AUTO_INCREMENT,
  `awb_number` varchar(50) COLLATE utf8_general_ci DEFAULT NULL,
  `Naquel_awb_number` varchar(50) COLLATE utf8_general_ci DEFAULT NULL,
  `Naquel_BookingRefNo` varchar(50) COLLATE utf8_general_ci DEFAULT NULL,
  `Request` longtext COLLATE utf8_general_ci,
  `Response` longtext COLLATE utf8_general_ci,
  `Label` longtext COLLATE utf8_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_by` int(8) DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` int(8) DEFAULT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `Id` (`Id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci; 